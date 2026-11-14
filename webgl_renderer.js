// WebGL 2 Spectrogram Renderer

class WebGLSpectrogramRenderer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) throw new Error("WebGL canvas not found: " + canvasId);
    
    this.gl = this.canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!this.gl) throw new Error("WebGL 2 not supported in this browser.");

    this.program = null;
    this.dataTextures = [];
    this.colormapTexture = null;
    
    // Uniform locations
    this.u_viewXLoc = null;
    this.u_viewWidthLoc = null;
    this.u_viewYLoc = null;
    this.u_viewHeightLoc = null;
    this.u_gainLoc = null;
    this.u_dbBottomLoc = null;
    this.u_dbTopLoc = null;

    // View state
    this.viewX = 0.0;
    this.viewWidth = 1.0;
    this.viewY = 0.0;
    this.viewHeight = 1.0;
    this.gain = 1.0;
    this.dbBottom = -100.0;
    this.dbTop = 0.0;

    this.initShaders();
    this.initGeometry();
  }

  initShaders() {
    const vsSource = `#version 300 es
      in vec2 a_position;
      out vec2 v_uv;
      void main() {
        // Map from clip space [-1, 1] to UV space [0, 1]
        v_uv = a_position * 0.5 + 0.5;
        // Direct mapping from clip space [-1, 1] to UV space [0, 1]
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    const fsSource = `#version 300 es
      precision highp float;
      
      uniform sampler2D u_dataTexture;
      uniform sampler2D u_colormap;
      
      uniform float u_viewX;
      uniform float u_viewWidth;
      uniform float u_viewY;
      uniform float u_viewHeight;
      uniform float u_gain;
      uniform float u_dbBottom;
      uniform float u_dbTop;
      
      in vec2 v_uv;
      out vec4 outColor;
      
      void main() {
        // Map screen UV to data texture coordinates
        // Texture X is Frequency (bins), Texture Y is Time (frames)
        vec2 dataCoord = vec2(
          u_viewY + (v_uv.y * u_viewHeight),
          u_viewX + (v_uv.x * u_viewWidth)
        );
        
        // If out of bounds, discard so we don't overwrite other chunks with black
        if (dataCoord.x < 0.0 || dataCoord.x > 1.0 || dataCoord.y < 0.0 || dataCoord.y > 1.0) {
          discard;
        }

        // Fetch magnitude
        float mag = texture(u_dataTexture, dataCoord).r;
        
        // Apply gain and convert to dB
        float magAdj = mag * u_gain;
        float db = 20.0 * log(max(magAdj, 1e-12)) / log(10.0);
        
        // Normalize
        float v = (db - u_dbBottom) / (u_dbTop - u_dbBottom);
        v = clamp(v, 0.0, 1.0);
        
        // Colormap lookup
        outColor = texture(u_colormap, vec2(v, 0.5));
      }
    `;

    const vertexShader = this.compileShader(this.gl.VERTEX_SHADER, vsSource);
    const fragmentShader = this.compileShader(this.gl.FRAGMENT_SHADER, fsSource);

    this.program = this.gl.createProgram();
    this.gl.attachShader(this.program, vertexShader);
    this.gl.attachShader(this.program, fragmentShader);
    this.gl.linkProgram(this.program);

    if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
      throw new Error("Unable to initialize the shader program: " + this.gl.getProgramInfoLog(this.program));
    }

    this.gl.useProgram(this.program);
    
    // Bind uniform locations
    this.u_viewXLoc = this.gl.getUniformLocation(this.program, "u_viewX");
    this.u_viewWidthLoc = this.gl.getUniformLocation(this.program, "u_viewWidth");
    this.u_viewYLoc = this.gl.getUniformLocation(this.program, "u_viewY");
    this.u_viewHeightLoc = this.gl.getUniformLocation(this.program, "u_viewHeight");
    this.u_gainLoc = this.gl.getUniformLocation(this.program, "u_gain");
    this.u_dbBottomLoc = this.gl.getUniformLocation(this.program, "u_dbBottom");
    this.u_dbTopLoc = this.gl.getUniformLocation(this.program, "u_dbTop");

    // Set texture units
    const u_dataTextureLoc = this.gl.getUniformLocation(this.program, "u_dataTexture");
    const u_colormapLoc = this.gl.getUniformLocation(this.program, "u_colormap");
    this.gl.uniform1i(u_dataTextureLoc, 0); // Unit 0
    this.gl.uniform1i(u_colormapLoc, 1);    // Unit 1
  }

  compileShader(type, source) {
    const shader = this.gl.createShader(type);
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const info = this.gl.getShaderInfoLog(shader);
      this.gl.deleteShader(shader);
      throw new Error("An error occurred compiling the shaders: " + info);
    }
    return shader;
  }

  initGeometry() {
    // Full screen quad
    const positions = new Float32Array([
      -1.0, -1.0,
       1.0, -1.0,
      -1.0,  1.0,
      -1.0,  1.0,
       1.0, -1.0,
       1.0,  1.0,
    ]);
    const positionBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, positionBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.STATIC_DRAW);

    const a_position = this.gl.getAttribLocation(this.program, "a_position");
    this.gl.enableVertexAttribArray(a_position);
    this.gl.vertexAttribPointer(a_position, 2, this.gl.FLOAT, false, 0, 0);
  }

  setColormap(lutUint8Array) {
    if (!this.colormapTexture) {
      this.colormapTexture = this.gl.createTexture();
    }
    this.gl.activeTexture(this.gl.TEXTURE1);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.colormapTexture);
    
    // 256 colors, 1 row, RGBA
    const rgba = new Uint8ClampedArray(1024);
    for (let i = 0; i < 256; i++) {
      rgba[i*4 + 0] = lutUint8Array[i*3 + 0];
      rgba[i*4 + 1] = lutUint8Array[i*3 + 1];
      rgba[i*4 + 2] = lutUint8Array[i*3 + 2];
      rgba[i*4 + 3] = 255;
    }
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA8, 256, 1, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, rgba);
    
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
  }

  reset() {
    if (this.dataTextures && this.dataTextures.length > 0) {
      for (const tex of this.dataTextures) {
        if (tex) {
          try { this.gl.deleteTexture(tex); } catch (e) {}
        }
      }
    }
    this.dataTextures = [];
    this.chunkWidths = [];
  }

  trimChunks(neededChunks) {
    if (!this.dataTextures) return;
    while (this.dataTextures.length > neededChunks) {
      const tex = this.dataTextures.pop();
      if (tex) {
        try { this.gl.deleteTexture(tex); } catch (e) {}
      }
    }
    if (this.chunkWidths && this.chunkWidths.length > neededChunks) {
      this.chunkWidths.length = neededChunks;
    }
  }

  setSpectrogramData(float32Array, width, height, chunkIndex = 0) {
    if (!this.dataTextures[chunkIndex]) {
      this.dataTextures[chunkIndex] = this.gl.createTexture();
    }
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.dataTextures[chunkIndex]);
    
    // R32F format
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.R32F, width, height, 0, this.gl.RED, this.gl.FLOAT, float32Array);
    
    // Try linear filtering, fallback to nearest if not supported
    const ext = this.gl.getExtension("OES_texture_float_linear");
    const filter = ext ? this.gl.LINEAR : this.gl.NEAREST;
    
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, filter);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, filter);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

    // Save chunk metadata (height is frames)
    this.chunkWidths = this.chunkWidths || [];
    this.chunkWidths[chunkIndex] = height;
  }

  updateUniforms(viewX, viewWidth, viewY, viewHeight, gain, dbBottom, dbTop) {
    this.viewX = viewX;
    this.viewWidth = viewWidth;
    this.viewY = viewY;
    this.viewHeight = viewHeight;
    this.gain = gain;
    this.dbBottom = dbBottom;
    this.dbTop = dbTop;
  }

  draw() {
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.gl.clearColor(0.0, 0.0, 0.0, 1.0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    this.gl.useProgram(this.program);

    this.gl.uniform1f(this.u_viewWidthLoc, this.viewWidth);
    this.gl.uniform1f(this.u_viewYLoc, this.viewY);
    this.gl.uniform1f(this.u_viewHeightLoc, this.viewHeight);
    this.gl.uniform1f(this.u_gainLoc, this.gain);
    this.gl.uniform1f(this.u_dbBottomLoc, this.dbBottom);
    this.gl.uniform1f(this.u_dbTopLoc, this.dbTop);

    this.gl.activeTexture(this.gl.TEXTURE1);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.colormapTexture);

    let totalWidth = this.chunkWidths.reduce((a, b) => a + (b || 0), 0);
    if (totalWidth <= 0) return;

    let chunkOffsetPixels = 0;

    for (let i = 0; i < this.dataTextures.length; i++) {
      let chunkW = this.chunkWidths[i] || 0;
      if (chunkW <= 0) continue;
      let chunkStartFrac = chunkOffsetPixels / totalWidth;
      let chunkEndFrac = (chunkOffsetPixels + chunkW) / totalWidth;

      // Only draw if this chunk intersects the current view
      if (chunkEndFrac > this.viewX && chunkStartFrac < this.viewX + this.viewWidth) {
        // Calculate the viewX relative to THIS chunk's UV space
        let localViewX = (this.viewX - chunkStartFrac) * (totalWidth / chunkW);
        let localViewWidth = this.viewWidth * (totalWidth / chunkW);

        this.gl.uniform1f(this.u_viewXLoc, localViewX);
        this.gl.uniform1f(this.u_viewWidthLoc, localViewWidth);

        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.dataTextures[i]);
        this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
      }
      chunkOffsetPixels += chunkW;
    }
  }
}

globalThis.WebGLSpectrogramRenderer = WebGLSpectrogramRenderer;

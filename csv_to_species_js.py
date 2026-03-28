#!/usr/bin/env python3
"""
csv_to_species_js.py

Usage:
    python csv_to_species_js.py taxonomy.csv

Output:
    Overwrites species-data.js in the same folder as the input CSV.
    File content will be:
      window.__speciesRecords = [ ... ];
"""

import csv
import json
import os
import sys
import tempfile

def normalize_header_map(headers):
    # map header lowercased -> index
    return {h.strip().lower(): i for i, h in enumerate(headers) if h is not None}

def get_value(row, idx_map, key):
    idx = idx_map.get(key)
    if idx is None or idx >= len(row):
        return ''
    return row[idx].strip()

def build_record(row, idx_map):
    # preserve group_id
    group_id = get_value(row, idx_map, 'group_id')
    # English/common name (CSV header may be 'eng_name' or 'common' etc.)
    eng_name = get_value(row, idx_map, 'eng_name') or get_value(row, idx_map, 'common') or get_value(row, idx_map, 'english_name')
    # scientific name built from genus + species if present, else try 'scientific' header
    genus = get_value(row, idx_map, 'genus')
    species = get_value(row, idx_map, 'species')
    scientific = " ".join(p for p in (genus, species) if p) or get_value(row, idx_map, 'scientific')
    # try to populate a key field from common header names (id, key, code, ebird_code)
    key = get_value(row, idx_map, 'key') or get_value(row, idx_map, 'id') or get_value(row, idx_map, 'code') or get_value(row, idx_map, 'ebird_code')
    rec = {
        "group_id": group_id,
        "common": eng_name,
        "scientific": scientific
    }
    if key:
        rec["key"] = key
    return rec

def atomic_write(path, content, encoding='utf-8'):
    dirpath = os.path.dirname(path) or '.'
    fd, tmp_path = tempfile.mkstemp(dir=dirpath, prefix='.tmp-species-', suffix='.js')
    try:
        with os.fdopen(fd, 'w', encoding=encoding) as tmp:
            tmp.write(content)
        os.replace(tmp_path, path)
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass

def main():
    if len(sys.argv) != 2:
        print("Usage: python csv_to_species_js.py <taxonomy.csv>")
        sys.exit(1)

    input_path = sys.argv[1]
    if not os.path.isfile(input_path):
        print(f"Error: file not found: {input_path}")
        sys.exit(1)

    out_dir = os.path.dirname(os.path.abspath(input_path)) or "."
    out_path = os.path.join(out_dir, "species-data.js")

    records = []
    with open(input_path, newline='', encoding='utf-8') as f:
        reader = csv.reader(f)
        try:
            headers = next(reader)
        except StopIteration:
            print("Error: CSV file is empty.")
            sys.exit(1)

        header_map = normalize_header_map(headers)

        for row in reader:
            if not any((cell.strip() if isinstance(cell, str) else False) for cell in row):
                continue
            if len(row) < len(headers):
                row = row + [''] * (len(headers) - len(row))
            records.append(build_record(row, header_map))

    json_array = json.dumps(records, ensure_ascii=False, indent=2)
    output_content = "window.__speciesRecords = " + json_array + ";\n"

    atomic_write(out_path, output_content, encoding='utf-8')
    print(f"Wrote {len(records)} records to {out_path}")

if __name__ == "__main__":
    main()
#!/usr/bin/env python3
"""
SDTMIG v3.4 variable lookup tool.
Source: 'SDTMIG v3.4 Classes and Columns.csv' alongside this script.

Usage:
  python lookup.py --domain AG
  python lookup.py --domain AG --var AGSTAT
  python lookup.py --domain AG --core Perm
  python lookup.py --var STAT          # wildcard: matches any --STAT / AGSTAT / etc.
  python lookup.py --domains           # list all available domains
"""

import argparse
import csv
import os
import sys

CSV_PATH = os.path.join(os.path.dirname(__file__), 'SDTMIG v3.4 Classes and Columns.csv')


def _load_rows():
    if not os.path.exists(CSV_PATH):
        print(f"ERROR: Cannot find {CSV_PATH}", file=sys.stderr)
        sys.exit(1)
    with open(CSV_PATH, newline='', encoding='utf-8') as fh:
        return list(csv.DictReader(fh))


def _fmt_row(row):
    return {
        'Domain':    row['Domain'],
        'Class':     row['SDTM Class'],
        'Variable':  row['Variable Name'],
        'Label':     row['Variable Label'],
        'Type':      row['Type'],
        'Role':      row['Role'],
        'Core':      row['Core'],
        'CT Codes':  row['CDISC CT Codelist Code(s)'],
        'Val List':  row['Value List'],
        'Notes':     row['CDISC Notes'],
    }


def list_domains(rows):
    for domain in sorted({r['Domain'] for r in rows if r.get('Domain')}):
        print(domain)


def _print_record(r, prefix_domain=False):
    head = f"  {r['Domain']:<6} " if prefix_domain else "  "
    print(f"{head}{r['Variable']:<20} Core={r['Core']:<5}  Role={r['Role']:<18} Type={r['Type']:<5}  Label={r['Label']}")
    pad = ' ' * (len(head) + 20)
    if r['Val List']:
        print(f"{pad} Values: {r['Val List']}")
    if r['Notes']:
        note = r['Notes'][:120] + ('...' if len(r['Notes']) > 120 else '')
        print(f"{pad} Note: {note}")


def lookup_domain(rows, domain, var_filter=None, core_filter=None):
    key = domain.upper()
    available = {r['Domain'] for r in rows}
    if key not in available:
        print(f"Domain '{domain}' not found. Use --domains to list all.")
        sys.exit(1)

    results = []
    for row in rows:
        if row['Domain'] != key:
            continue
        rec = _fmt_row(row)
        if not rec['Variable']:
            continue
        if var_filter:
            vf = var_filter.upper()
            vn = rec['Variable'].upper()
            if vn != vf and not vn.endswith(vf):
                continue
        if core_filter:
            if (rec['Core'] or '').upper() != core_filter.upper():
                continue
        results.append(rec)

    if not results:
        print(f"No variables found in {domain} matching the filter.")
        return

    for r in results:
        _print_record(r)


def lookup_variable_all_domains(rows, var_filter):
    vf = var_filter.upper()
    found = []
    for row in rows:
        vn = (row['Variable Name'] or '').upper()
        if not vn:
            continue
        if vn == vf or vn.endswith(vf):
            found.append(_fmt_row(row))

    if not found:
        print(f"Variable matching '{var_filter}' not found in any domain.")
        return

    found.sort(key=lambda r: (r['Domain'], r['Variable']))
    for r in found:
        print(f"  {r['Domain']:<6} {r['Variable']:<20} Core={r['Core']:<5}  Role={r['Role']}")


def main():
    parser = argparse.ArgumentParser(description='SDTMIG v3.4 variable lookup')
    parser.add_argument('--domain',   help='Domain abbreviation (e.g. AG, AE, DM)')
    parser.add_argument('--var',      help='Variable name or suffix (e.g. STAT, AGSTAT)')
    parser.add_argument('--core',     help='Filter by Core status: Req, Exp, or Perm')
    parser.add_argument('--domains',  action='store_true', help='List all available domains')
    args = parser.parse_args()

    rows = _load_rows()

    if args.domains:
        list_domains(rows)
    elif args.domain and not args.var and not args.core:
        lookup_domain(rows, args.domain)
    elif args.domain:
        lookup_domain(rows, args.domain, var_filter=args.var, core_filter=args.core)
    elif args.var and not args.domain:
        lookup_variable_all_domains(rows, args.var)
    else:
        parser.print_help()


if __name__ == '__main__':
    main()

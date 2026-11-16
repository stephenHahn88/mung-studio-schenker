"""Mean and sample standard deviation over runs.

Each argument is one value of the statistic: a score.py output file, or several files joined by '+', whose values
are averaged first.

usage:
  python aggregate.py out/H_run1.json out/H_run2.json
  python aggregate.py out/s1_rf42.json+out/s1_rf43.json out/s2_rf42.json+out/s2_rf43.json ...
"""
import argparse
import json
import statistics as st
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('values', nargs='+', help='score.py output files; FILE+FILE averages runs into one value')
    args = parser.parse_args()
    values = []
    for item in args.values:
        runs = [json.loads(Path(f).read_text()) for f in item.split('+')]
        columns = list(runs[0])
        values.append({c: st.mean(r[c] for r in runs) for c in columns})
    if len(values) < 2:
        raise SystemExit('At least two values are needed for a standard deviation')
    columns = list(values[0])
    for c in columns:
        print(f'{c:>14s}  {st.mean(v[c] for v in values):.2f}±{st.stdev(v[c] for v in values):.2f}')


if __name__ == '__main__':
    main()

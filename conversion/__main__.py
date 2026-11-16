"""Command line: python -m conversion PAGE.xml -o PAGE.json [--image PAGE.jpg] [--report REPORT.json]"""
import argparse
import json
from pathlib import Path
import sys

from .convert import convert_page
from .mung import ConversionError


def write_json(path, payload):
    Path(path).write_text(json.dumps(payload, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python -m conversion",
                                     description="Convert an annotated MuNG page into SchenkerNote JSON (Algorithm 1).")
    parser.add_argument("mung", type=Path, help="MuNG XML file with syntax links, precedence links and time groups")
    parser.add_argument("-o", "--output", type=Path, required=True, help="where to write the SchenkerNote JSON")
    parser.add_argument("--image", type=Path, help="page image (default: an image next to the XML file)")
    parser.add_argument("--report", type=Path, help="also write per-notehead results, unresolved cases and details")
    args = parser.parse_args(argv)
    try:
        result = convert_page(args.mung, args.image)
    except (ConversionError, OSError) as error:
        print(f"Conversion error: {error}", file=sys.stderr)
        return 1
    write_json(args.output, result["schenkernote"])
    if args.report:
        write_json(args.report, {k: v for k, v in result.items() if k != "schenkernote"})
    summary = result["summary"]
    print(f"{result['document']}: {summary['complete_noteheads']} of {summary['noteheads']} noteheads written "
          f"at {summary['time_positions']} time positions; {len(result['unresolved'])} unresolved, "
          f"{summary['warnings']} warnings.")
    for case in result["unresolved"]:
        print(f"  unresolved {case['code']} {case['node_ids']}: {case['message']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

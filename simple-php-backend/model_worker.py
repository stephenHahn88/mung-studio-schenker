"""Run one model function of the repository in its own Python process.

Used by model_actions.py:

    python model_worker.py < request.json > result.json

The request is a JSON object {"action": ..., "repo_root": ..., "kwargs": {...}}.
The worker puts the folder of the component first on sys.path, imports its
module and calls the function with the keyword arguments:

    symbols      experiments/symbol_recognition/inference.py   detect_symbols
    syntaxLinks  experiments/syntax_links/inference.py         predict_syntax_links
    timeGroups   experiments/temporal_relations/inference.py   predict_time_groups
    precedence   experiments/temporal_relations/inference.py   predict_precedence
    conversion   conversion (package at the repository root)   convert_page

The return value is written to standard output as {"result": ...}. An
exception is written as {"error": message, "type": class name, "importError":
bool, "valueError": bool}. Everything the libraries print goes to standard
error.
"""

import importlib
import json
import os
import sys
import traceback

FUNCTIONS = {
    "symbols": ("experiments/symbol_recognition", "inference", "detect_symbols"),
    "syntaxLinks": ("experiments/syntax_links", "inference", "predict_syntax_links"),
    "timeGroups": ("experiments/temporal_relations", "inference", "predict_time_groups"),
    "precedence": ("experiments/temporal_relations", "inference", "predict_precedence"),
    "conversion": ("", "conversion", "convert_page"),
}


def _plain(value):
    """JSON fallback for NumPy scalars and arrays."""
    if hasattr(value, "tolist"):
        return value.tolist()
    raise TypeError(f"{type(value).__name__} is not JSON serializable")


def main() -> None:
    result_stream = os.fdopen(os.dup(1), "w", encoding="utf-8")
    os.dup2(2, 1)
    sys.stdout = sys.stderr

    request = json.load(sys.stdin)
    folder, module_name, function_name = FUNCTIONS[request["action"]]
    here = os.path.dirname(os.path.abspath(__file__))
    sys.path[:] = [p for p in sys.path if os.path.abspath(p or ".") != here]
    sys.path.insert(0, os.path.join(request["repo_root"], folder))

    try:
        function = getattr(importlib.import_module(module_name), function_name)
        payload = {"result": function(**request["kwargs"])}
        text = json.dumps(payload, default=_plain, allow_nan=False)
    except Exception as exc:
        traceback.print_exc()
        text = json.dumps({
            "error": str(exc) or type(exc).__name__,
            "type": type(exc).__name__,
            "importError": isinstance(exc, ImportError),
            "valueError": isinstance(exc, ValueError),
        })
    result_stream.write(text)
    result_stream.close()


if __name__ == "__main__":
    main()

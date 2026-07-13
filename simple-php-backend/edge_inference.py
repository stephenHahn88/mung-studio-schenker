"""Stable MuNG Studio edge-inference entry point.

The implementation lives in :mod:`edge_inference_learned`.  Keeping this shim
small lets a backend that has not imported ``edge_inference`` yet pick up the
new model without changing ``server.py`` or restarting the collaboration hub.
If the old module is already present in ``sys.modules``, the deployment must
wait for a maintenance-window restart instead of disturbing active annotators.
"""

from edge_inference_learned import get_model_info, main, predict_edges

__all__ = ["get_model_info", "predict_edges"]


if __name__ == "__main__":
    raise SystemExit(main())

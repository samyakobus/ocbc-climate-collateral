"""Put the repo root on sys.path so `import prep...` works under pytest.

pytest inserts the *test* directory into sys.path, not the project root, so
without this every `tests/prep` module would need its own path preamble.
"""

import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

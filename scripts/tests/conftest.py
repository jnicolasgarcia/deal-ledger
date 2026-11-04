import sys
from pathlib import Path

# Make scripts/ importable (stage_map, ingest, profile_workbook).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

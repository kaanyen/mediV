"""
Prescription Module - Production-ready microservice for drug suggestions.
"""

from .interface import get_ghana_suggestions, reload_database, get_drug_by_id
from .engine import PrescriptionEngine

__all__ = [
    "get_ghana_suggestions",
    "reload_database",
    "get_drug_by_id",
    "PrescriptionEngine"
]

__version__ = "1.0.0"


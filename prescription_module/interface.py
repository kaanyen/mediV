"""
Public Interface for Prescription Module
Clean entry point for integration with main application.
"""
from typing import Dict, List, Optional
from .engine import PrescriptionEngine


# Global engine instance (singleton pattern for efficiency)
_engine: Optional[PrescriptionEngine] = None


def _get_engine() -> PrescriptionEngine:
    """Get or create the global engine instance."""
    global _engine
    if _engine is None:
        _engine = PrescriptionEngine()
    return _engine


def get_ghana_suggestions(diagnosis_input: str) -> Dict:
    """
    Public interface function to get NHIS-compliant drug suggestions for a diagnosis.
    
    This is the main entry point that can be imported into the main app.
    
    Args:
        diagnosis_input: Diagnosis string from the application (e.g., "Severe Malaria")
    
    Returns:
        Dictionary with structure:
        {
            "status": "success" | "not_found",
            "diagnosis": <input diagnosis>,
            "matches": [
                {
                    "id": "gh-001",
                    "generic_name": "artemether-lumefantrine",
                    "nhis_level": "A",
                    "formulation": "Tablet",
                    "adult_dosage": "80/480 mg twice daily for 3 days",
                    "safety_warning": "Take with fatty food..."
                },
                ...
            ],
            "count": <number of matches>
        }
        
        If no matches found:
        {
            "status": "not_found",
            "diagnosis": <input diagnosis>,
            "matches": [],
            "count": 0,
            "message": "No NHIS-compliant drug found"
        }
    """
    if not diagnosis_input or not isinstance(diagnosis_input, str):
        return {
            "status": "not_found",
            "diagnosis": diagnosis_input or "",
            "matches": [],
            "count": 0,
            "message": "Invalid diagnosis input"
        }
    
    # Initialize engine
    engine = _get_engine()
    
    # Run search
    matches = engine.find_drugs_for(diagnosis_input)
    
    # Format results
    if not matches:
        return {
            "status": "not_found",
            "diagnosis": diagnosis_input,
            "matches": [],
            "count": 0,
            "message": "No NHIS-compliant drug found"
        }
    
    # Return structured dictionary with matched drugs
    formatted_matches = []
    for drug in matches:
        formatted_matches.append({
            "id": drug.get("id"),
            "generic_name": drug.get("generic_name"),
            "nhis_level": drug.get("nhis_level"),
            "formulation": drug.get("formulation"),
            "adult_dosage": drug.get("adult_dosage"),
            "safety_warning": drug.get("safety_warning")
        })
    
    return {
        "status": "success",
        "diagnosis": diagnosis_input,
        "matches": formatted_matches,
        "count": len(formatted_matches)
    }


def reload_database():
    """
    Reload the prescription database from disk.
    Useful for hot-reloading in production without restarting the service.
    """
    global _engine
    if _engine is not None:
        _engine.reload_database()
    else:
        _engine = PrescriptionEngine()


def get_drug_by_id(drug_id: str) -> Optional[Dict]:
    """
    Get a specific drug by its ID.
    
    Args:
        drug_id: The drug ID to look up
    
    Returns:
        Drug dictionary if found, None otherwise
    """
    engine = _get_engine()
    return engine.get_drug_by_id(drug_id)


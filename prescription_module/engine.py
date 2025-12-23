"""
Prescription Engine - Real search algorithm for matching drugs to diagnoses.
No mock data, no simulations - production-ready keyword matching.
"""
import json
import os
from pathlib import Path
from typing import Dict, List, Optional


class PrescriptionEngine:
    """
    Production-ready prescription search engine.
    Implements real keyword matching algorithm against Ghana Essential Medicines List.
    """
    
    def __init__(self, db_path: Optional[str] = None):
        """
        Initialize the engine by loading the database into memory.
        
        Args:
            db_path: Optional path to database JSON file. 
                    Defaults to db_schema.json in the same directory.
        """
        if db_path is None:
            # Get the directory where this file is located
            current_dir = Path(__file__).parent
            db_path = current_dir / "db_schema.json"
        
        self.db_path = Path(db_path)
        if not self.db_path.exists():
            raise FileNotFoundError(f"Database file not found: {self.db_path}")
        
        # Load database into memory efficiently
        with open(self.db_path, 'r', encoding='utf-8') as f:
            self.database: List[Dict] = json.load(f)
        
        if not isinstance(self.database, list):
            raise ValueError("Database must be a JSON array")
        
        print(f"[PrescriptionEngine] Loaded {len(self.database)} drugs from database")
    
    def find_drugs_for(self, diagnosis: str) -> List[Dict]:
        """
        Find drugs matching the given diagnosis using keyword matching algorithm.
        
        Algorithm:
        1. Convert input diagnosis to lowercase for case-insensitive matching
        2. Iterate through database drugs
        3. For each drug, check if any indication_tag is found inside the diagnosis string
        4. Return all matching drugs
        5. Sort results by NHIS level (A first, then B, then C)
        
        Args:
            diagnosis: Input diagnosis string (e.g., "Severe Malaria", "uncomplicated malaria")
        
        Returns:
            List of matching drug dictionaries, sorted by NHIS level priority
        """
        if not diagnosis or not isinstance(diagnosis, str):
            return []
        
        # Convert input to lowercase for case-insensitive matching
        diagnosis_lower = diagnosis.lower().strip()
        
        if not diagnosis_lower:
            return []
        
        # Keyword Matching Algorithm
        matches: List[Dict] = []
        
        for drug in self.database:
            # Get indications_tags from drug
            indications_tags = drug.get("indications_tags", [])
            
            if not isinstance(indications_tags, list):
                continue
            
            # Check if any tag is found inside the diagnosis string
            for tag in indications_tags:
                if not isinstance(tag, str):
                    continue
                
                tag_lower = tag.lower().strip()
                
                # Real keyword matching: check if tag is found inside diagnosis
                if tag_lower in diagnosis_lower:
                    # Found a match - add drug to results
                    matches.append(drug.copy())  # Use copy to avoid reference issues
                    break  # Only add each drug once, even if multiple tags match
        
        # Filtering: Sort by NHIS level (A first, then B, then C)
        nhis_priority = {"A": 1, "B": 2, "C": 3}
        
        def get_nhis_priority(drug: Dict) -> int:
            """Get numeric priority for sorting (lower = higher priority)"""
            nhis_level = drug.get("nhis_level", "").upper()
            return nhis_priority.get(nhis_level, 999)  # Unknown levels go last
        
        # Sort matches by NHIS level
        matches.sort(key=get_nhis_priority)
        
        return matches
    
    def get_drug_by_id(self, drug_id: str) -> Optional[Dict]:
        """
        Retrieve a specific drug by its ID.
        
        Args:
            drug_id: The drug ID to look up
        
        Returns:
            Drug dictionary if found, None otherwise
        """
        for drug in self.database:
            if drug.get("id") == drug_id:
                return drug.copy()
        return None
    
    def reload_database(self):
        """Reload the database from disk (useful for hot-reloading in production)"""
        with open(self.db_path, 'r', encoding='utf-8') as f:
            self.database = json.load(f)
        print(f"[PrescriptionEngine] Reloaded {len(self.database)} drugs from database")


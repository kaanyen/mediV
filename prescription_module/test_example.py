"""
Example test script to verify the prescription module works correctly.
Run this to test the search algorithm.
"""
import sys
from pathlib import Path

# Add parent directory to path for proper imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from prescription_module import get_ghana_suggestions

def test_search():
    """Test various diagnosis inputs"""
    
    test_cases = [
        "Severe Malaria",
        "uncomplicated malaria",
        "Patient has malaria",
        "plasmodium infection",
        "fever and chills",
        "Unknown Condition"
    ]
    
    print("=" * 60)
    print("PRESCRIPTION MODULE TEST")
    print("=" * 60)
    
    for diagnosis in test_cases:
        print(f"\n🔍 Searching for: '{diagnosis}'")
        result = get_ghana_suggestions(diagnosis)
        
        if result["status"] == "success":
            print(f"✅ Found {result['count']} match(es):")
            for drug in result["matches"]:
                print(f"   • {drug['generic_name']} (NHIS Level {drug['nhis_level']})")
                print(f"     Dosage: {drug['adult_dosage']}")
                print(f"     Warning: {drug['safety_warning']}")
        else:
            print(f"❌ {result['message']}")
    
    print("\n" + "=" * 60)
    print("TEST COMPLETE")
    print("=" * 60)

if __name__ == "__main__":
    test_search()


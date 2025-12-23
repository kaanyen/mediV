"""
Test script to verify prescription module integration
"""
import sys
from pathlib import Path

# Add parent directory to path
backend_dir = Path(__file__).parent
project_root = backend_dir.parent
sys.path.insert(0, str(project_root))

try:
    from prescription_module import get_ghana_suggestions
    
    print("=" * 60)
    print("PRESCRIPTION MODULE INTEGRATION TEST")
    print("=" * 60)
    
    # Test case 1: Malaria diagnosis
    print("\n1. Testing with 'Malaria' diagnosis:")
    result = get_ghana_suggestions("Malaria")
    print(f"   Status: {result['status']}")
    print(f"   Matches: {result['count']}")
    if result['matches']:
        for drug in result['matches']:
            print(f"   - {drug['generic_name']} (NHIS Level {drug['nhis_level']})")
    
    # Test case 2: Condition with description
    print("\n2. Testing with 'Severe Malaria with fever' diagnosis:")
    result = get_ghana_suggestions("Severe Malaria with fever")
    print(f"   Status: {result['status']}")
    print(f"   Matches: {result['count']}")
    if result['matches']:
        for drug in result['matches']:
            print(f"   - {drug['generic_name']} (NHIS Level {drug['nhis_level']})")
    
    # Test case 3: Unknown condition
    print("\n3. Testing with 'Unknown Condition' diagnosis:")
    result = get_ghana_suggestions("Unknown Condition")
    print(f"   Status: {result['status']}")
    print(f"   Message: {result.get('message', 'N/A')}")
    
    print("\n" + "=" * 60)
    print("INTEGRATION TEST COMPLETE")
    print("=" * 60)
    
except ImportError as e:
    print(f"ERROR: Could not import prescription module: {e}")
    sys.exit(1)


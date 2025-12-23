#!/usr/bin/env python3
"""Quick test to verify the drugs API endpoint is working"""
import requests
import json

try:
    response = requests.get("http://localhost:8000/drugs")
    if response.status_code == 200:
        data = response.json()
        drugs = data.get("drugs", [])
        print(f"✅ API is working! Found {len(drugs)} drugs")
        print(f"\nFirst 10 drugs:")
        for i, drug in enumerate(drugs[:10], 1):
            print(f"  {i}. {drug.get('name')} - Stock: {drug.get('stock')}")
        if len(drugs) < 100:
            print(f"\n⚠️  Warning: Expected 100 drugs but found {len(drugs)}")
            print("   Make sure the backend server was restarted after adding the 100 drugs.")
        else:
            print(f"\n✅ Perfect! All 100 drugs are loaded.")
    else:
        print(f"❌ API returned status code: {response.status_code}")
        print(f"Response: {response.text}")
except requests.exceptions.ConnectionError:
    print("❌ Could not connect to backend server at http://localhost:8000")
    print("   Make sure the backend is running: cd backend && uvicorn main:app --reload")
except Exception as e:
    print(f"❌ Error: {e}")


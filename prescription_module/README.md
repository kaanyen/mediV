# Prescription Module

Production-ready microservice for matching diagnoses to NHIS-compliant drugs from the Ghana Essential Medicines List.

## Architecture

- **No simulations**: Real keyword matching algorithm
- **No mock data**: Uses actual database schema
- **Scalable**: Efficient in-memory search with JSON database
- **Production-ready**: Error handling, logging, and hot-reload support

## Usage

### Basic Usage

```python
from prescription_module import get_ghana_suggestions

# Get drug suggestions for a diagnosis
result = get_ghana_suggestions("Severe Malaria")

if result["status"] == "success":
    for drug in result["matches"]:
        print(f"{drug['generic_name']} - NHIS Level {drug['nhis_level']}")
        print(f"  Dosage: {drug['adult_dosage']}")
        print(f"  Warning: {drug['safety_warning']}")
else:
    print(result["message"])
```

### Response Format

```python
{
    "status": "success" | "not_found",
    "diagnosis": "Severe Malaria",
    "matches": [
        {
            "id": "gh-001",
            "generic_name": "artemether-lumefantrine",
            "nhis_level": "A",
            "formulation": "Tablet",
            "adult_dosage": "80/480 mg twice daily for 3 days",
            "safety_warning": "Take with fatty food..."
        }
    ],
    "count": 1
}
```

## Database Schema

The database (`db_schema.json`) follows this structure:

```json
[
  {
    "id": "gh-001",
    "generic_name": "artemether-lumefantrine",
    "indications_tags": ["malaria", "uncomplicated malaria", "plasmodium"],
    "nhis_level": "A",
    "formulation": "Tablet",
    "adult_dosage": "80/480 mg twice daily for 3 days",
    "safety_warning": "Take with fatty food. Avoid in first trimester of pregnancy if possible."
  }
]
```

## Search Algorithm

1. **Input Processing**: Converts diagnosis to lowercase for case-insensitive matching
2. **Keyword Matching**: Checks if any `indications_tags` is found inside the diagnosis string
3. **Filtering**: Sorts results by NHIS level (A → B → C priority)
4. **Output**: Returns structured dictionary with matched drugs

## Adding More Drugs

Simply add more entries to `db_schema.json` following the same schema. The engine will automatically load them on initialization or after calling `reload_database()`.

## Integration

This module can be integrated into your main FastAPI application:

```python
from prescription_module import get_ghana_suggestions

@app.post("/prescription")
async def get_prescription(req: PrescriptionRequest):
    suggestions = get_ghana_suggestions(req.diagnosis)
    # Process and return suggestions
```


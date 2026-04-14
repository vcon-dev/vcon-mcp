import json
import uuid
import datetime
import random
import hashlib

def generate_mock_vcon(vcon_id=None):
    if not vcon_id:
        vcon_id = str(uuid.uuid4())
    now = datetime.datetime.now(datetime.timezone.utc)
    
    return {
        "vcon": "0.0.1",
        "uuid": vcon_id,
        "created_at": now.isoformat(),
        "parties": [
            {
                "tel": "+1234567890",
                "name": "Alice Agent",
                "role": "agent"
            },
            {
                "tel": "+0987654321",
                "name": "Bob Customer",
                "role": "customer"
            }
        ],
        "dialog": [
            {
                "type": "text",
                "start": (now - datetime.timedelta(minutes=5)).isoformat(),
                "parties": [0, 1],
                "body": "Hello, how can I help you today?",
                "mimetype": "text/plain"
            },
            {
                "type": "text",
                "start": (now - datetime.timedelta(minutes=4)).isoformat(),
                "parties": [1, 0],
                "body": "I'm having trouble logging into my account.",
                "mimetype": "text/plain"
            }
        ],
        "analysis": [
            {
                "type": "sentiment",
                "vendor": "mock_analyzer",
                "body": {
                    "overall_sentiment": "neutral",
                    "score": random.uniform(0.1, 0.9)
                }
            },
            {
                "type": "summary",
                "vendor": "mock_analyzer",
                "body": "Customer is experiencing login issues."
            }
        ]
    }

def get_db_stats():
    # Mocking IDatabaseInspector stats
    return {
        "collections": ["vcons", "vcon_embeddings"],
        "document_counts": {
            "vcons": random.randint(1000, 5000),
            "vcon_embeddings": random.randint(1000, 5000),
        },
        "storage_size_kb": random.randint(50000, 200000)
    }

def get_growth_analytics():
    # Mocking IDatabaseAnalytics growth trends (e.g. last 7 days)
    today = datetime.datetime.now(datetime.timezone.utc).date()
    data = []
    for i in range(7):
        date = today - datetime.timedelta(days=6-i)
        data.append({
            "date": date.strftime("%Y-%m-%d"),
            "count": random.randint(50, 200)
        })
    return data

def get_tag_analytics():
     # Mock tag usage breakdown
     tags = ["support", "sales", "billing", "escalation", "feedback"]
     return [{"tag": t, "count": random.randint(10, 500)} for t in tags]

def mock_hybrid_search(query: str):
    # Simulating hybrid keyword/vector search results
    results = []
    for _ in range(3):
        v = generate_mock_vcon()
        # Ensure the mock dialog contains the query word to look like a match
        v["dialog"][0]["body"] = f"Yes, regarding {query}, we can help."
        results.append({
            "vcon": v,
            "score": random.uniform(0.7, 0.99)
        })
    return results

def to_jsonld(vcon):
    vcon_copy = vcon.copy()
    vcon_copy["@context"] = [
        "https://schema.org/docs/jsonldcontext.json",
        {
            "vcon": "https://vcon.dev/ns/",
            "xsd": "http://www.w3.org/2001/XMLSchema#",
            "parties": "vcon:parties",
            "dialog": "vcon:dialog",
            "analysis": "vcon:analysis",
            "type": "@type",
            "vendor": "vcon:vendor",
            "body": "vcon:body",
            "@confidence": {
                "@id": "https://w3id.org/jsonld-ex/confidence",
                "@type": "xsd:float"
            },
            "@source": {
                "@id": "https://w3id.org/jsonld-ex/source",
                "@type": "@id"
            },
            "@integrity": {
                "@id": "https://w3id.org/jsonld-ex/integrity",
                "@type": "xsd:string"
            }
        }
    ]
    return vcon_copy

def enrich_analysis(vcon, confidence: float, source: str):
    vcon_copy = json.loads(json.dumps(vcon)) # deep copy
    if "analysis" not in vcon_copy or not isinstance(vcon_copy["analysis"], list) or len(vcon_copy["analysis"]) == 0:
        # Inject a dummy analysis block so the demo has something to enrich
        vcon_copy["analysis"] = [{
            "type": "demo_enrichment",
            "vendor": "custom_upload_handler",
            "body": "No existing analysis blocks found, so this one was generated for the demo."
        }]
        
    for a in vcon_copy["analysis"]:
        if isinstance(a, dict):
            a["@confidence"] = confidence
            a["@source"] = source
    return vcon_copy

def sign_vcon(vcon):
    vcon_copy = json.loads(json.dumps(vcon))
    if "@integrity" in vcon_copy:
        del vcon_copy["@integrity"]
    
    # Deterministic stringify (simplified for Python, sorting keys)
    serialized = json.dumps(vcon_copy, sort_keys=True, separators=(',', ':'))
    hash_obj = hashlib.sha256(serialized.encode('utf-8'))
    hash_hex = hash_obj.hexdigest()
    
    vcon_copy["@integrity"] = f"sha256-{hash_hex}"
    return vcon_copy

def verify_integrity(vcon):
    if "@integrity" not in vcon:
        return False, "Missing @integrity field"
    
    provided_hash = vcon["@integrity"]
    
    # Recompute
    vcon_copy = json.loads(json.dumps(vcon))
    del vcon_copy["@integrity"]
    serialized = json.dumps(vcon_copy, sort_keys=True, separators=(',', ':'))
    hash_obj = hashlib.sha256(serialized.encode('utf-8'))
    computed_hash = f"sha256-{hash_obj.hexdigest()}"
    
    if provided_hash == computed_hash:
        return True, "vCon is authentic and untampered."
    else:
        return False, f"Integrity check failed! Expected {computed_hash}, got {provided_hash}"


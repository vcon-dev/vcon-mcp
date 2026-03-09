import mock_data

vcon = mock_data.generate_mock_vcon()
jsonld_vcon = mock_data.to_jsonld(vcon)
enriched = mock_data.enrich_analysis(jsonld_vcon, 0.95, "src1")
signed = mock_data.sign_vcon(enriched)

valid, msg = mock_data.verify_integrity(signed)
print(f"Original signature valid: {valid} - {msg}")

# Tamper
signed["parties"][0]["name"] = "Malicious Actor"
valid2, msg2 = mock_data.verify_integrity(signed)
print(f"Tampered signature valid: {valid2} - {msg2}")

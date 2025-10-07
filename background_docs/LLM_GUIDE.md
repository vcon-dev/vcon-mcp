# vCon Library Guide for LLMs

This guide provides a comprehensive overview of the vCon (Virtual Conversation) Python library, designed specifically for Large Language Models (LLMs) that need to generate or modify code using this library.

## Overview

The vCon library is a Python tool for structuring, managing, and manipulating conversation data in a standardized format called vCon (Virtual Conversation). It enables the creation, validation, and manipulation of digital representations of conversations with rich metadata.

### Key Concepts

- **vCon Container**: The primary object that holds all conversation data
- **Parties**: Participants in a conversation (callers, agents, bots)
- **Dialogs**: Individual messages or segments of the conversation
- **Attachments**: Additional files or data associated with the conversation
- **Analysis**: Results from processing the conversation (sentiment analysis, transcription, etc.)

## Installation

```bash
pip install vcon
```

## Core Classes and Usage Patterns

### 1. Vcon Class

The main container for all conversation data.

#### Creating a vCon

```python
from vcon import Vcon

# Create a new empty vCon
vcon = Vcon.build_new()

# Create from existing JSON
vcon = Vcon.build_from_json(json_string)

# Load from file
vcon = Vcon.load_from_file("conversation.json")

# Load from URL
vcon = Vcon.load_from_url("https://example.com/conversation.json")

# Generic load (detects if path or URL)
vcon = Vcon.load("conversation.json")  # or URL
```

#### Saving and Exporting

```python
# Save to file
vcon.save_to_file("conversation.json")

# Convert to JSON string
json_str = vcon.to_json()  # or vcon.dumps()

# Convert to dictionary
vcon_dict = vcon.to_dict()

# Post to URL with optional headers
response = vcon.post_to_url(
    'https://api.example.com/vcons',
    headers={'x-api-token': 'your-token-here'}
)
```

#### Properties

```python
# Access properties
uuid = vcon.uuid
version = vcon.vcon
created_at = vcon.created_at
updated_at = vcon.updated_at
parties_list = vcon.parties
dialog_list = vcon.dialog
attachments_list = vcon.attachments
analysis_list = vcon.analysis
```

### 2. Party Class

Represents a participant in the conversation.

```python
from vcon.party import Party

# Create a party
caller = Party(
    tel="+1234567890",
    name="Alice Smith",
    role="caller",
    mailto="alice@example.com"
)

# Add to vCon
vcon.add_party(caller)

# Find a party by an attribute
party_index = vcon.find_party_index("name", "Alice Smith")  # Returns index (0-based)
```

#### Party Attributes

- `tel`: Telephone number
- `name`: Display name
- `role`: Role in conversation (e.g., "caller", "agent")
- `mailto`: Email address
- `uuid`: Unique identifier
- `stir`: STIR verification
- `validation`: Validation status
- `gmlpos`: Geographic position
- `civicaddress`: Civic address (using CivicAddress class)
- `meta`: Additional metadata
- Custom attributes can be added via kwargs

### 3. Dialog Class

Represents a message or segment in the conversation.

```python
from vcon.dialog import Dialog
from datetime import datetime, timezone

# Create a text dialog
text_dialog = Dialog(
    type="text",
    start=datetime.now(timezone.utc).isoformat(),
    parties=[0, 1],  # Indices of parties involved
    originator=0,    # Index of the party that sent the message
    mimetype="text/plain",
    body="Hello, I need help with my account."
)

# Add to vCon
vcon.add_dialog(text_dialog)

# Create an audio dialog
audio_dialog = Dialog(
    type="audio",
    start=datetime.now(timezone.utc).isoformat(),
    parties=[0, 1],
    originator=0,
    mimetype="audio/mp3",
    body=base64_encoded_audio,
    encoding="base64",
    filename="recording.mp3"
)

vcon.add_dialog(audio_dialog)

# Find a dialog by property
found_dialog = vcon.find_dialog("type", "text")
```

#### Special Dialog Types

```python
# Add a transfer dialog
vcon.add_transfer_dialog(
    start=datetime.now(timezone.utc).isoformat(),
    transfer_data={
        "reason": "Call forwarded",
        "from": "+1234567890",
        "to": "+1987654321"
    },
    parties=[0, 1]
)

# Add an incomplete dialog (for failed conversations)
vcon.add_incomplete_dialog(
    start=datetime.now(timezone.utc).isoformat(),
    disposition="NO_ANSWER",
    details={"ringDuration": 45000},
    parties=[0, 1]
)
```

#### Dialog Type Methods

```python
# Check dialog type
is_text = dialog.is_text()
is_recording = dialog.is_recording()
is_transfer = dialog.is_transfer()
is_incomplete = dialog.is_incomplete()
is_audio = dialog.is_audio()
is_video = dialog.is_video()
is_email = dialog.is_email()
```

#### Supported MIME Types

- `text/plain`
- `audio/x-wav`, `audio/wav`, `audio/wave`
- `audio/mpeg`, `audio/mp3`
- `audio/ogg`
- `audio/webm`
- `audio/x-m4a`
- `audio/aac`
- `video/x-mp4`
- `video/ogg`
- `multipart/mixed`
- `message/rfc822` (for email)
- `application/json` (for signaling data)

### 4. Working with Tags

Tags are key-value pairs for simple metadata.

```python
# Add tags
vcon.add_tag("customer_id", "12345")
vcon.add_tag("interaction_id", "INT-001")

# Get tag value
value = vcon.get_tag("customer_id")  # Returns "12345"

# Get all tags
all_tags = vcon.tags  # Returns the tags attachment dictionary
```

### 5. Working with Attachments

Attachments are arbitrary data associated with the conversation.

```python
# Add an attachment
vcon.add_attachment(
    type="transcript",
    body="Conversation transcript content...",
    encoding="none"
)

# Add a base64-encoded attachment
vcon.add_attachment(
    type="recording",
    body=base64_encoded_content,
    encoding="base64url"
)

# Find an attachment
attachment = vcon.find_attachment_by_type("transcript")
```

### 6. Working with Analysis

Analysis entries represent insights derived from dialog.

```python
# Add analysis
vcon.add_analysis(
    type="sentiment",
    dialog=[0],  # Index or indices of dialogs analyzed
    vendor="AnalysisCompany",
    body={"sentiment": "positive", "score": 0.8},
    encoding="json"
)

# Find analysis
analysis = vcon.find_analysis_by_type("sentiment")
```

## 7. Security and Validation

### Signing and Verification

```python
# Generate a key pair
private_key, public_key = Vcon.generate_key_pair()

# Sign the vCon
vcon.sign(private_key)

# Verify the signature
is_valid = vcon.verify(public_key)
```

### Validation

```python
# Validate a vCon object
is_valid, errors = vcon.is_valid()
if not is_valid:
    print("Validation errors:", errors)

# Validate a file
is_valid, errors = Vcon.validate_file("conversation.json")

# Validate a JSON string
is_valid, errors = Vcon.validate_json(json_string)
```

## Common Patterns and Best Practices

### 1. Creating a Complete Conversation

```python
from vcon import Vcon
from vcon.party import Party
from vcon.dialog import Dialog
from datetime import datetime, timezone

# Create a new vCon
vcon = Vcon.build_new()

# Add participants
caller = Party(tel="+1234567890", name="Alice", role="caller")
agent = Party(tel="+1987654321", name="Bob", role="agent")
vcon.add_party(caller)
vcon.add_party(agent)

# Add conversation dialogs in sequence
vcon.add_dialog(Dialog(
    type="text",
    start=datetime.now(timezone.utc).isoformat(),
    parties=[0, 1],
    originator=0,  # Caller
    mimetype="text/plain",
    body="Hello, I need help with my account."
))

vcon.add_dialog(Dialog(
    type="text",
    start=datetime.now(timezone.utc).isoformat(),
    parties=[0, 1],
    originator=1,  # Agent
    mimetype="text/plain",
    body="I'd be happy to help. Can you provide your account number?"
))

# Add metadata
vcon.add_tag("customer_id", "12345")
vcon.add_tag("interaction_id", "INT-001")

# Validate and save
is_valid, errors = vcon.is_valid()
if is_valid:
    vcon.save_to_file("conversation.json")
else:
    print("Validation errors:", errors)
```

### 2. Working with Audio Content

```python
import base64

# Reading an audio file and adding it to a dialog
with open("recording.mp3", "rb") as f:
    audio_data = f.read()
    audio_base64 = base64.b64encode(audio_data).decode("utf-8")

audio_dialog = Dialog(
    type="audio",
    start=datetime.now(timezone.utc).isoformat(),
    parties=[0, 1],
    originator=0,
    mimetype="audio/mp3",
    body=audio_base64,
    encoding="base64",
    filename="recording.mp3"
)
vcon.add_dialog(audio_dialog)
```

### 3. External vs Inline Content

```python
# External content (referenced by URL)
external_dialog = Dialog(
    type="recording",
    start=datetime.now(timezone.utc).isoformat(),
    parties=[0, 1],
    url="https://example.com/recordings/call123.mp3",
    mimetype="audio/mp3"
)

# Check if dialog refers to external content
if external_dialog.is_external_data():
    # Convert to inline data
    external_dialog.to_inline_data()

# Check if dialog contains inline data
if dialog.is_inline_data():
    print("Dialog contains embedded content")
```

## Error Handling

```python
try:
    vcon = Vcon.load_from_file("conversation.json")
    is_valid, errors = vcon.is_valid()
    if not is_valid:
        print("Validation errors:", errors)
except FileNotFoundError:
    print("File not found")
except json.JSONDecodeError:
    print("Invalid JSON format")
except Exception as e:
    print(f"Error: {str(e)}")
```

## Working with Property Handling Modes

The Vcon constructor accepts a `property_handling` parameter to control how non-standard properties are handled:

```python
# Default mode: keep non-standard properties
vcon = Vcon(vcon_dict)  # or Vcon(vcon_dict, property_handling="default")

# Strict mode: remove non-standard properties
vcon = Vcon(vcon_dict, property_handling="strict")

# Meta mode: move non-standard properties to meta object
vcon = Vcon(vcon_dict, property_handling="meta")
```

## Conclusion

The vCon library provides a comprehensive framework for working with conversation data. When generating code:

1. Start by creating a vCon container with `Vcon.build_new()`
2. Add parties using the `Party` class and `vcon.add_party()`
3. Add dialog entries using the `Dialog` class and `vcon.add_dialog()`
4. Add metadata with `vcon.add_tag()`, attachments with `vcon.add_attachment()`, and analysis with `vcon.add_analysis()`
5. Validate the vCon with `vcon.is_valid()`
6. Save with `vcon.save_to_file()` or export with `vcon.to_json()`
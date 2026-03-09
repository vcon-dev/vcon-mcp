"""
Generate a demo audio file for Whisper sidecar testing.
Creates a short simulated customer service call as a WAV file
using edge-tts (Microsoft Edge TTS — free, high quality).

Usage:
  pip install edge-tts
  python generate_demo_audio.py

Output: demo-call.wav + demo-call.xml in hackathon/watch/siprec/
"""

import asyncio
import os
import sys

# Check for edge-tts
try:
    import edge_tts
except ImportError:
    print("Installing edge-tts...")
    os.system(f"{sys.executable} -m pip install edge-tts")
    import edge_tts

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'sample-data')
WAV_PATH = os.path.join(OUTPUT_DIR, 'demo-call.mp3')
XML_PATH = os.path.join(OUTPUT_DIR, 'demo-call.xml')

# Simulated call transcript — two speakers
# We'll generate it as a single narrated audio for simplicity
SCRIPT = """
Hello, thank you for calling Acme Wireless. My name is Jennifer. How can I help you today?

Hi Jennifer, this is Robert Martinez. I've been having issues with my internet connection for the past three days. It keeps dropping every few hours and the speed is way below what I'm paying for.

I'm sorry to hear that, Robert. Let me pull up your account. Can you give me your account number?

Sure, it's A C 7 7 4 2 1.

Thank you. I can see your account. It looks like there was a network upgrade in your area last week. Some customers have been experiencing intermittent connectivity. Let me run a diagnostic on your line.

That would be great. I work from home, so reliable internet is critical for me.

I completely understand. The diagnostic shows some signal degradation on your line. I'm going to reset your connection from our end and also schedule a technician visit for tomorrow morning between 9 and 11. Would that work for you?

Tomorrow morning works. Will there be any charge for the technician visit?

No, this will be completely free since the issue is on our end. I'm also going to apply a credit to your account for the three days of service disruption.

Thank you Jennifer, I really appreciate that. You've been very helpful.

You're welcome, Robert. Is there anything else I can help you with today?

No, that's everything. Thanks again.

Thank you for calling Acme Wireless. Have a great day!
""".strip()

# SIPREC-style XML metadata (no .txt file — forces Whisper transcription)
XML_CONTENT = """<?xml version="1.0" encoding="UTF-8"?>
<recording>
  <session id="DEMO-WHISPER-001">
    <start-time>2026-03-09T09:15:00Z</start-time>
    <end-time>2026-03-09T09:17:30Z</end-time>
  </session>
  <caller>
    <number>+15553847291</number>
    <name>Robert Martinez</name>
  </caller>
  <callee>
    <number>+15551000200</number>
    <name>Agent Jennifer Walsh</name>
  </callee>
  <direction>inbound</direction>
</recording>
"""


async def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print(f"Generating demo audio with Edge TTS...")
    print(f"Script length: {len(SCRIPT)} characters")

    # Use a natural-sounding voice
    communicate = edge_tts.Communicate(SCRIPT, "en-US-JennyNeural", rate="+5%")
    await communicate.save(WAV_PATH)
    print(f"Audio saved: {WAV_PATH}")

    # Write XML metadata
    with open(XML_PATH, 'w') as f:
        f.write(XML_CONTENT)
    print(f"XML saved: {XML_PATH}")

    print(f"\n✓ Files ready in: {os.path.abspath(OUTPUT_DIR)}")
    print(f"  demo-call.mp3  — Audio file for Whisper demo")
    print(f"  demo-call.xml  — SIPREC metadata (for folder-drop demo)")
    print(f"\nTo demo via Ingest page:")
    print(f"  1. Open ingest.html → Audio Upload tab")
    print(f"  2. Enter caller/agent names")
    print(f"  3. Browse to: {os.path.abspath(WAV_PATH)}")
    print(f"  4. Whisper will auto-transcribe on your GPU")
    print(f"  5. Click Submit → full pipeline fires")
    print(f"\nTo demo via folder drop:")
    print(f"  Copy demo-call.xml + demo-call.mp3 (no .txt!) to hackathon/watch/siprec/")


if __name__ == '__main__':
    asyncio.run(main())

# vCon MCP Features Example App

This is a standalone Streamlit application built to demonstrate the MongoDB Analytics/Search and JSON-LD (`jsonld-ex`) features of the vCon MCP server.

It uses mock data generated on-the-fly to simulate how the vCon server processes, enriches, signs, and searches conversation data. No actual MongoDB database or live vCon server is required to run this demo.

## Features Showcased
- **JSON-LD Context**: Converting standard vCons to semantic web documents.
- **Analysis Enrichment**: Attaching `@confidence` and `@source` metadata to vendor analyses.
- **Cryptographic Integrity**: Tamper-evident signing of vCons using deterministic SHA-256 hashing.
- **MongoDB Analytics**: Simulated visualizations of database growth and tag usage.
- **Vector Search**: A simulated hybrid search experience finding vCons based on dialog content.

## How to Run

1. Ensure you have Python installed.
2. Navigate to this directory in your terminal:
   ```bash
   cd examples/example1
   ```
3. Install the dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Run the Streamlit app:
   ```bash
   streamlit run app.py
   ```

A browser window should automatically open pointing to `http://localhost:8501`.

## Using the Demo
- Explore the **JSON-LD & Integrity** tab to step through a vCon's lifecycle or load a custom `.vcon` file (a `sample.vcon` file is provided). You can use the "Reset to Random" button to start fresh or modify loaded data to see integrity verification fail.
- Explore the **Database & Analytics** tab to view the dashboard and run searches against the simulated database.

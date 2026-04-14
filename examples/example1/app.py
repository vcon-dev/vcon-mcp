import streamlit as st
import pandas as pd
import altair as alt
import json
import mock_data

st.set_page_config(page_title="vCon Example App", page_icon="📞", layout="wide")

# Initialize session state for the vCon lifecycle demo
if "current_vcon" not in st.session_state:
    st.session_state.current_vcon = mock_data.generate_mock_vcon()

if "jsonld_step" not in st.session_state:
    st.session_state.jsonld_step = "raw" 

st.title("📞 vCon Features Example App")
st.markdown("This application demonstrates the MongoDB and JSON-LD (`jsonld-ex`) features built for the vCon MCP server.")

tab1, tab2 = st.tabs(["semantic Web & Integrity (`jsonld-ex`)", "Database & Analytics (MongoDB)"])

with tab1:
    st.header("JSON-LD Lifecycle")
    st.markdown("Step through the process of converting a standard vCon into a cryptographically sound semantic document.")
    
    # Action buttons
    col1, col2, col3, col4, col5 = st.columns(5)
    with col1:
        if st.button("🔄 Reset to Random"):
            st.session_state.current_vcon = mock_data.generate_mock_vcon()
            st.session_state.jsonld_step = "raw"
            st.rerun()
    with col2:
        if st.button("➕ 1. Add Context") and st.session_state.jsonld_step == "raw":
            st.session_state.current_vcon = mock_data.to_jsonld(st.session_state.current_vcon)
            st.session_state.jsonld_step = "context"
            st.rerun()
    with col3:
        if st.button("✨ 2. Enrich Analysis") and st.session_state.jsonld_step == "context":
            st.session_state.current_vcon = mock_data.enrich_analysis(
                st.session_state.current_vcon, 
                confidence=0.98, 
                source="https://api.openai.com/v1/chat/completions"
            )
            st.session_state.jsonld_step = "enrich"
            st.rerun()
    with col4:
        if st.button("🔐 3. Sign vCon") and st.session_state.jsonld_step == "enrich":
            st.session_state.current_vcon = mock_data.sign_vcon(st.session_state.current_vcon)
            st.session_state.jsonld_step = "signed"
            st.rerun()
    with col5:
        if st.button("✅ 4. Verify Integrity") and st.session_state.jsonld_step == "signed":
            is_valid, msg = mock_data.verify_integrity(st.session_state.current_vcon)
            if is_valid:
                st.success(msg)
            else:
                st.error(msg)
                
    st.divider()
    
    st.subheader("Load Custom vCon")
    uploaded_file = st.file_uploader("Upload a .vcon file", type=["vcon", "json"])
    if uploaded_file is not None:
        try:
            content = json.load(uploaded_file)
            st.session_state.current_vcon = content
            st.session_state.jsonld_step = "raw"
            if "@integrity" in content:
                 st.session_state.jsonld_step = "signed"
                 st.info("Loaded a signed vCon.")
            elif "@context" in content:
                st.session_state.jsonld_step = "context"
            st.success("vCon loaded successfully!")
        except Exception as e:
            st.error(f"Failed to load vCon: {e}")
            
    st.divider()
    
    col_view1, col_view2 = st.columns([1,1])
    with col_view1:
        st.subheader("Current State")
        st.write(f"**Step:** {st.session_state.jsonld_step.upper()}")
        st.json(st.session_state.current_vcon)
        
    with col_view2:
        if st.session_state.jsonld_step == "signed":
            st.subheader("Simulate Tampering")
            st.warning("Modify a value in the vCon to see integrity verification fail.")
            tamper_text = st.text_input("Change Data to:", value="Malicious Actor")
            if st.button("Inject Change"):
                # Try to modify a common field, otherwise just inject a root property
                if "parties" in st.session_state.current_vcon and len(st.session_state.current_vcon["parties"]) > 0:
                     st.session_state.current_vcon["parties"][0]["name"] = tamper_text
                else:
                     st.session_state.current_vcon["tampered_data"] = tamper_text
                # We must rerun so the JSON view on the left updates with the tampered data
                st.rerun()

with tab2:
    st.header("MongoDB Analytics & Search")
    st.markdown("Simulated output mirroring the `IDatabaseAnalytics` and `IVConQueries` implementations.")
    
    st.subheader("System Stats")
    stats = mock_data.get_db_stats()
    c1, c2, c3 = st.columns(3)
    c1.metric("Total vCons", f"{stats['document_counts']['vcons']:,}")
    c2.metric("Total Embeddings", f"{stats['document_counts']['vcon_embeddings']:,}")
    c3.metric("Storage Size", f"{stats['storage_size_kb']/1024:.2f} MB")
    
    st.divider()
    
    scol1, scol2 = st.columns(2)
    with scol1:
         st.subheader("📈 Growth Trends")
         growth_data = mock_data.get_growth_analytics()
         df_growth = pd.DataFrame(growth_data)
         chart = alt.Chart(df_growth).mark_line(point=True).encode(
             x='date:T',
             y='count:Q',
             tooltip=['date', 'count']
         ).properties(height=300)
         st.altair_chart(chart, use_container_width=True)
         
    with scol2:
         st.subheader("🏷️ Top Tags")
         tag_data = mock_data.get_tag_analytics()
         df_tags = pd.DataFrame(tag_data)
         bar_chart = alt.Chart(df_tags).mark_bar().encode(
             x='count:Q',
             y=alt.Y('tag:N', sort='-x'),
             color='tag:N',
             tooltip=['tag', 'count']
         ).properties(height=300)
         st.altair_chart(bar_chart, use_container_width=True)
         
    st.divider()
    st.subheader("🔍 Vector Hybrid Search")
    query = st.text_input("Search vCons (Keyword or Semantic)", value="login issues")
    if st.button("Search"):
        with st.spinner("Executing simulated $vectorSearch..."):
            results = mock_data.mock_hybrid_search(query)
            st.success(f"Found {len(results)} matches.")
            for i, res in enumerate(results):
                with st.expander(f"Match {i+1} - Score: {res['score']:.4f}"):
                    st.json(res['vcon'])

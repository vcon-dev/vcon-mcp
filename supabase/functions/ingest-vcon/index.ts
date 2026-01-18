import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Party {
  tel?: string;
  sip?: string;
  mailto?: string;
  name?: string;
  uuid?: string;
  did?: string;
  meta?: Record<string, unknown>;
  role?: string;
  gmlpos?: string;
  civicaddress?: string;
  timezone?: string;
}

interface Dialog {
  type: string;
  start?: string;
  duration?: number;
  parties?: number[];
  originator?: number;
  mimetype?: string;
  filename?: string;
  body?: string;
  encoding?: string;
  url?: string;
  alg?: string;
  signature?: string;
  disposition?: string;
  party_history?: unknown[];
  transferee?: number;
  transferor?: number;
  transfer_target?: number;
  original?: number;
  consultation?: number;
  target_dialog?: number;
  campaign?: string;
  interaction?: string;
  skill?: string;
  meta?: Record<string, unknown>;
}

interface Analysis {
  type: string;
  vendor: string;
  dialog?: number | number[];
  body?: string;
  encoding?: string;
  schema?: string;
  product?: string;
  extra?: Record<string, unknown>;
}

interface Attachment {
  type: string;
  body?: string;
  encoding?: string;
  url?: string;
  party?: number;
  dialog?: number;
  extra?: Record<string, unknown>;
}

interface VCon {
  uuid: string;
  vcon?: string;
  created_at?: string;
  subject?: string;
  redacted?: Record<string, unknown>;
  appended?: Record<string, unknown>;
  group?: unknown[];
  parties?: Party[];
  dialog?: Dialog[];
  analysis?: Analysis[];
  attachments?: Attachment[];
  extensions?: string[];
  must_support?: string[];
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const vcon: VCon = await req.json();

    if (!vcon.uuid) {
      return new Response(
        JSON.stringify({ error: "vCon uuid is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert main vCon record
    const { data: vconRecord, error: vconError } = await supabase
      .from("vcons")
      .upsert({
        uuid: vcon.uuid,
        vcon_version: vcon.vcon || "0.0.1",
        subject: vcon.subject,
        created_at: vcon.created_at || new Date().toISOString(),
        redacted: vcon.redacted || {},
        appended: vcon.appended || {},
        group_data: vcon.group || [],
        extensions: vcon.extensions || [],
        must_support: vcon.must_support || [],
      }, {
        onConflict: "uuid",
      })
      .select("id, uuid")
      .single();

    if (vconError) {
      console.error("Error inserting vCon:", vconError);
      return new Response(
        JSON.stringify({ error: "Failed to insert vCon", details: vconError }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const vconId = vconRecord.id;

    // Insert parties
    if (vcon.parties && vcon.parties.length > 0) {
      // Delete existing parties for this vcon (for upsert behavior)
      await supabase.from("parties").delete().eq("vcon_id", vconId);

      const partiesData = vcon.parties.map((party, index) => ({
        vcon_id: vconId,
        party_index: index,
        tel: party.tel,
        sip: party.sip,
        mailto: party.mailto,
        name: party.name,
        uuid: party.uuid,
        did: party.did,
        metadata: party.meta || {},
        gmlpos: party.gmlpos,
        civicaddress: typeof party.civicaddress === 'string' ? { address: party.civicaddress } : party.civicaddress,
        timezone: party.timezone,
      }));

      const { error: partiesError } = await supabase.from("parties").insert(partiesData);
      if (partiesError) {
        console.error("Error inserting parties:", partiesError);
      }
    }

    // Insert dialog
    if (vcon.dialog && vcon.dialog.length > 0) {
      await supabase.from("dialog").delete().eq("vcon_id", vconId);

      const dialogData = vcon.dialog.map((d, index) => ({
        vcon_id: vconId,
        dialog_index: index,
        type: d.type,
        start_time: d.start,
        duration_seconds: d.duration,
        parties: d.parties,
        originator: d.originator,
        mediatype: d.mimetype,
        filename: d.filename,
        body: d.body,
        encoding: d.encoding,
        url: d.url,
        disposition: d.disposition,
        transferee: d.transferee,
        transferor: d.transferor,
        transfer_target: d.transfer_target ? [d.transfer_target] : null,
        original: d.original ? [d.original] : null,
        consultation: d.consultation ? [d.consultation] : null,
        target_dialog: d.target_dialog ? [d.target_dialog] : null,
        metadata: d.meta || {},
      }));

      const { error: dialogError } = await supabase.from("dialog").insert(dialogData);
      if (dialogError) {
        console.error("Error inserting dialog:", dialogError);
      }
    }

    // Insert analysis
    if (vcon.analysis && vcon.analysis.length > 0) {
      await supabase.from("analysis").delete().eq("vcon_id", vconId);

      const analysisData = vcon.analysis.map((a, index) => ({
        vcon_id: vconId,
        analysis_index: index,
        type: a.type,
        vendor: a.vendor,
        dialog_index: Array.isArray(a.dialog) ? a.dialog : (a.dialog !== undefined ? [a.dialog] : null),
        body: a.body,
        encoding: a.encoding,
        schema: a.schema,
        product: a.product,
        extra: a.extra,
      }));

      const { error: analysisError } = await supabase.from("analysis").insert(analysisData);
      if (analysisError) {
        console.error("Error inserting analysis:", analysisError);
      }
    }

    // Insert attachments
    if (vcon.attachments && vcon.attachments.length > 0) {
      await supabase.from("attachments").delete().eq("vcon_id", vconId);

      const attachmentsData = vcon.attachments.map((a, index) => ({
        vcon_id: vconId,
        attachment_index: index,
        type: a.type,
        body: a.body,
        encoding: a.encoding,
        url: a.url,
        party_index: a.party,
        dialog_index: a.dialog,
        extra: a.extra,
      }));

      const { error: attachmentsError } = await supabase.from("attachments").insert(attachmentsData);
      if (attachmentsError) {
        console.error("Error inserting attachments:", attachmentsError);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        vcon_id: vconId,
        uuid: vcon.uuid
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );

  } catch (error) {
    console.error("Error processing vCon:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

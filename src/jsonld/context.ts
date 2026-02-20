
/**
 * JSON-LD Context for vCon
 * 
 * Defines the mapping of vCon terms to IRIs.
 * Includes @jsonld-ex/core extensions for AI/ML metadata.
 */

export const VCON_CONTEXT = {
    "@context": [
        "https://schema.org/docs/jsonldcontext.json",
        {
            "vcon": "https://vcon.dev/ns/",
            "xsd": "http://www.w3.org/2001/XMLSchema#",

            // vCon Core Terms
            "parties": "vcon:parties",
            "dialog": "vcon:dialog",
            "analysis": "vcon:analysis",
            "attachments": "vcon:attachments",
            "group": "vcon:group",
            "redacted": "vcon:redacted",
            "appended": "vcon:appended",

            // Analysis Terms
            "type": "@type",
            "vendor": "vcon:vendor",
            "product": "vcon:product",
            "schema": "vcon:schema",
            "body": "vcon:body",
            "encoding": "vcon:encoding",

            // @jsonld-ex Extensions
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
};

export interface JsonLdDocument {
    "@context"?: any;
    [key: string]: any;
}

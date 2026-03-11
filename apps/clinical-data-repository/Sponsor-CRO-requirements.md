# What Sponsor Requires from CRO

In almost all sponsor–CRO setups, the sponsor is expected to define data standards and transfer requirements (not only the protocol), and the CRO should not improvise these on its own.

## What the Sponsor Usually Provides

Typical inputs from the sponsor (sometimes via a “study setup package”) include:

- **Protocol and synopsis:** Defines what needs to be collected, endpoints, and visits.  
- **CRF/eCRF design:** Or at least a CRF library/CDASH standards that the CRO must use.  
- **Data standards:** Typically CDISC SDTM and ADaM, plus controlled terminology expectations.  
- **Metadata specifications:** Datasets, variables, formats, code lists, derivation rules, visit structures, and mapping guidelines.  
- **Statistical Analysis Plan (SAP):** Drives which derived variables and analysis-ready structures are needed.

These may be fully sponsor-owned (mature company with standards library) or partially delegated to the CRO (small biotech relying on CRO templates), but even then, the sponsor must confirm and approve the standards.

## Data Transfer Specifications / “Data Scheme”

Beyond the above, there is usually a dedicated **Data Transfer Specification (DTS)** or similar document that formally defines *what and how* the CRO must send back.

### Common Elements

- **Dataset list:** Which domains/files, timing (interim, periodic, final), and delivery milestones.  
- **Structure:** Rows/columns, keys, variable names/labels, data types, formats, length, coding dictionaries.  
- **Business rules:** Derivations, edit checks, handling of missing/partial dates, visit windows.  
- **Technical format:** SAS XPT, CSV, XML, SDTM with Define.xml, or EDC vendor export format.  
- **Transfer mechanism and controls:** Encryption, SFTP/portal, frequency, QC procedures, and reconciliation rules (e.g., against safety databases or eTMF).

This DTS often sits alongside or is referenced in the **Data Management Plan (DMP)** and the CRO contract or a generic **Data Transfer Agreement (DTA)** template.

## Regulatory and Contractual Context

**ICH E6 (GCP)** states that the sponsor remains responsible for the quality and integrity of trial data even if duties are transferred to a CRO. Therefore, sponsors must clearly specify expectations and standards.

Contracts and work orders typically enumerate:

- Which SOPs and standards the CRO must follow  
- What deliverables (including datasets and documentation) must be provided

### In Practice

The CRO “knows what to send” because the sponsor either:

1. Provides its own standards library and DTS, or  
2. Approves the CRO’s proposed standards and DTS during study startup, before database build and first patient in.

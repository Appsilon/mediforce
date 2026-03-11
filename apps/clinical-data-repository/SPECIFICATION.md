# Demo Application Specification

## Assumptions for the Demo App

- Application will be a standalone Next.js app
- Application will be deployed to Firebase
- User files will be uploaded to the Firebase Storage.  
- Application views will be built for the user persona "Sponsor"
- Reuse visual style from the Mediforce application

---

## Application Title

**Clinical Data Repository**

---

General purpose of the app:
During the clinical trial study, the Sponsor delegates collecting the study data to the CRO (Contract Research Organization). This app will help the Sponsor with verifying and validating the data received from the CRO.

## Sponsor Use Cases

The sponsor wants to:

- Provide requirements to the CRO.  
- Receive the data from the CRO and verify it.  
- Send queries to the CRO (requests for data corrections).  
- Receive alerts if data is not delivered on the agreed timeline.

---

## View 1: Requirements

**View name:** Visible in the application menu.

**Use case:**  
In this view, the Sponsor provides requirements to the CRO — expected data format, schema, protocol, and other documents that support data validation.

**How this view looks:**  
- Displayed as both **cards** and **table views** representing files in storage.  
- Each file shows: *name, type, size, upload date,* and *AI-generated summary* (mocked for the demo).  
- Users can **switch between card and table views**.  
- Users can **upload new files**.  
- Clicking a file card or row opens the **File Viewer** view.

---

## View 2: Study Data

**View name:** Visible in the application menu.

**Use case:**  
In this view, the Sponsor receives study data from the CRO — files uploaded to Firebase storage.

**How this view looks:**  
- Similar layout to the *Requirements* view.  
- For demo purposes, users can also **manually upload files** from this view.

**What’s different from the Requirements view:**  
- If a file has issues found by the AI validation agents, it displays:  
  - A **warning icon**, and  
  - Message: *“Data contains issues — click to see details.”*

---

## View 3: Validation Issues

**View name:** Visible in the application menu.

**Use case:**  
Sponsor can see all issues identified in the data, be alerted when expected data is missing, and understand what AI agents check during validation.

**How this view looks:**  
- Displays a **list of warnings** found in the data.  
- Each entry includes:
  - File name  
  - Column and row details  
  - Description of the issue or warning (e.g., missing or late file)

---

## View 4: Validation Rules

**View name:** Visible in the application menu.

**Use case:**  
Sponsor can review what AI agents use for validation — summaries of validation rules based on the provided Requirements — and manually add additional prompts.

**How this view looks:**  
- Displays a **list of rules** interpreted by AI agents based on the Requirements files.  
- Includes a button **“Add new validation rule”** that opens a text field to input a new rule.

---

## View 5: File Viewer

**View name:** *Not visible in the application menu.*  
It appears when the user clicks a specific file in either the *Requirements* or *Study Data* views.

**Use cases:**  
- Sponsor views file details.  
- Sponsor can **mark specific values and comment** on them.  
- Comments are aggregated into a **Query to the CRO**.

### What is a Query?

A **Query** is a text message written in the right sidebar requesting the CRO to fix data inconsistencies — such as discrepancies, wrong values, or missing data.

### Supported File Types

- **Tabular files:** `csv`, `xlsx`, `xpt` (SAS files)  
- **Text-based files:** `txt`, `xml`  
- **Document files:** `pdf`

### How this view looks:

- **CSV, XLSX, XPT files:**  
  Displayed as interactive tables (spreadsheet-like).  
  Clicking a cell opens a **context menu** with two options:
  1. **Add comment for Validation Agent** – adds input to the agent’s validation rules.  
  2. **Add comment for CRO** – adds the remark to the Query list.

- **TXT, XML files:**  
  Display raw content of the file.

- **PDF files:**  
  Display using an embedded **PDF viewer**.

### Query Sidebar

On the right side:
- Title: **Query to the CRO**  
- Contains a large text field for composing queries.  
- Interactive table comments automatically populate this query.  
  - Example: clicking a cell and adding a comment like *“Values like this are invalid”* creates an entry in the sidebar such as  
    *“Value in Column ABC, row 123 — values like this are invalid.”*  
- Once satisfied with the Query, the user can click **“Send Query”** and see it displayed as chat-style history.
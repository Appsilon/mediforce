# 📋 Meeting Minutes

Project: Mediforce \
Date: 2026-03-06 \
Time: 15:00 – 16:00 CET \
Location: Video call \

## 📅 Agenda
1. Introductions
2. Overview and Current State of the Mediforce Platform
3. Discussion 
4. Demonstration Use Case Proposal and Next Steps

### Topic 1 — Mediforce Platform Overview & Technical Direction

Appsilon team presented the Mediforce open source platform idea as a central hub for overseeing, controlling, and experimenting with AI agents deployed across multiple applications. The platform is designed as a tool for exploration and experimentation, not a final design. The platform's codebase was largely AI-generated and then human-reviewed.

The current platform supports choosing models, but local, on-premise model support is a priority for handling sensitive data like patient information.

Philip Toss introduced his open-source project, https://github.com/pjt222/agent-almanac/tree/main which provides a library for defining skills and agents that could be integrated into Mediforce.

### Topic 2 — Process Definition, Control, and Regulatory Compliance

Mediforce allows users to define sequential processes via YAML files, where each step can be performed by a human or an agent. A key feature is the ability to configure the autonomy level for each agent-led step, starting from a low "shadow" mode to higher levels, which ensures humans retain responsibility and control in critical parts of the process.

Regulatory compliance is a critical aspect, specifically adhering to the FDA's guiding principles of good AI practice in drug development (released January 2026). Following a risk-based approach for performance assessment from the start will help validate the software in highly regulated environments.

The distinction between process definition and execution policy (human vs. agent autonomy) was validated as a beneficial approach for auditability and validation.

### Topic 3 — Use Cases and implementation focus

Proposal for Demonstration Use Case: Clinical Data Quality Check: A discussion on the process for creating new tasks or agents led to a proposal for a demonstration application focusing on clinical data quality checking. The proposed use case involves AI agents proactively checking the quality of data snapshots from clinical trials and identifying issues like miscoded values or unexpected data for quick surfacing to prevent delays in data lock

Need for Realistic Sample Data: To build a working demo for the clinical data quality use case, the team noted the crucial need for a realistic, anonymized data set that mirrors formats sent from CROs to sponsors, such as MSSQL database exports or flat files. Eric Nantz mentioned that the R Consortium’s new Pilot 7 initiative is working to generate more realistic clinical data in SDTM and ADAM formats, which could potentially be a future resource. Pilot 7 is welcoming contribution.

## 📌 Action Items

**Action:** Create a tutorial for a first process or agent created on the platform.	\
**Action:** Look for realistic sample data (e.g., synthetic data sets) for building the clinical data quality check demo application. \
**Action:** Think about leveraging Philip Toss's repository for skills and agent definitions.
# 📋 Meeting Minutes

Project: Mediforce \
Date: 2026-03-13 \
Time: 15:00 – 16:00 CET \
Location: Video call \

## 📅 Agenda
1. Mediforce Platform Demo: Protocol to TLF Workflow\
2. Skill Management, Benchmarking, and Agent Confidence\
3. Security, Governance, and Mediforce's Value Proposition\
4. Mediforce Data Transfer Demo\

### Topic 1 — Mediforce Platform Demo: Protocol to TLF Workflow

Protocol to TLF process involves four steps performed by agents: extracting metadata, generating TLG shells, generating the ADAM data set (after uploading SDTM clinical data), and finally, generating the TLG.

Each step used a Claude Code agent running in Docker for security reasons.

Due to the high cost of Claude Code agents, Open Claw, an open-source alternative running on Deepseek, was integrated to provide a more cost-effective option for development and testing while reusing the same skills.

Team showcased the agent execution, including the detailed audit log and the agent's ability to create and follow a to-do list plan. The generated code is cloned and pushed to a GitHub repository.

A basic reviewer function is already working, where a human can claim a task, select "revise", and submit feedback to the agent, which then attempts to fix the issue. For complex outputs like code repositories, granular review should eventually happen on GitHub.

### Topic 2 — Skill Management, Benchmarking, and Agent Confidence

Claude Code is primarily used for managing and creating skills in the repository and is in a constant iteration loop.

A reproducible benchmark for testing agents has not yet been configured due to the difficulty of reproducible settings and resource limitations for running parallel instances.

The displayed confidence level (e.g., 70%) is currently an arbitrary claim created by the LLM and should not be relied upon. A more useful approach would be to track an agent's historical success rate for similar tasks. Team agreed that an "agent gym" with reproducible tests could be a way to gauge success.

### Topic 3 — Security, Governance, and Mediforce's Value Proposition

Security Concerns: The consensus for mitigating prompt injection is to restrict agents from accessing the internet, which is known as the "lethal trifecta" for LLM browsers.

Industry Bottleneck: The primary barrier to AI adoption in clinical trials is the sensitive nature of the data and the industry's inherent risk-averse posture. A platform goal should be to demonstrate that processes can run securely within a secured virtual cloud environment (e.g., AWS) without web search capabilities to assure data security.

Mediforce Governance Layer: The platform’s main value is not providing the agents but solving the problem of controlling, auditing, and making agent-based processes compliant within regulated environments. It serves as the necessary governance layer to bridge technological innovation with industry requirements for traceability and auditing.

Mediforce is the management hub for controlling and auditing AI agents. It allows users to define, implement, control, and supervise processes across any interface (e.g., a demo application or Gmail), ensuring reproducibility, audit logs, and necessary human approval steps.

### Topic 4 — Mediforce Data Transfer Demo

A demo application was shown (not yet integrated with Mediforce, agents mocked) showcasing the process of transferring study data from a CRO to a sponsor.

The application validates CRO-shared files against sponsor requirements (protocol, SAP), flags issues, and allows the sponsor to add comments for either the validation agent or the CRO to correct data issues.

## 📌 Action Items

None
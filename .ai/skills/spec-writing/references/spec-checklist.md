# Spec Review Checklist

Apply each section. Flag issues as Critical / High / Medium / Low.

## 1. Design & Phasing

- [ ] Each phase yields independently working code
- [ ] No phase depends on future phases to function
- [ ] Steps are small enough to verify individually
- [ ] Implementation order accounts for dependencies

## 2. Architecture & Boundaries

- [ ] Module boundaries are clearly defined
- [ ] No unnecessary coupling between modules
- [ ] Data flows are documented
- [ ] External dependencies are justified

## 3. Data Integrity & Security

- [ ] All inputs validated (zod or equivalent)
- [ ] No SQL injection, XSS, or command injection vectors
- [ ] Secrets are never logged or exposed in responses
- [ ] Auth/authz requirements are specified per endpoint

## 4. API Design

- [ ] RESTful conventions followed
- [ ] Error responses are documented
- [ ] Pagination strategy specified for list endpoints
- [ ] Breaking changes are flagged

## 5. Risks & Impact

- [ ] Risks use concrete failure scenarios (not vague descriptions)
- [ ] Each risk has severity and mitigation
- [ ] Cross-module impacts are identified
- [ ] Migration/deployment risks addressed

## 6. Completeness

- [ ] TLDR accurately summarizes the spec
- [ ] Open Questions are all resolved (or spec is blocked)
- [ ] No TODO/TBD/placeholder sections in finalized spec
- [ ] Changelog has initial entry

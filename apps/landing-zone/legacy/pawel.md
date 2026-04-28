Hej, przygotowałem draft wizji jak może wyglądać workflow do walidacji danych klinicznych. 

Claude sprawdził ~900 źródeł i stwierdził że najlepsze datasety są w repo https://github.com/RConsortium/submissions-pilot3-adam. Jutro możemy bazować na tym drafcie.

# HITL Workflow: Walidacja danych klinicznych CDISC

## Cel projektu

Demo workflow Human-in-the-Loop (HITL) do walidacji danych z badań klinicznych zgodnie ze standardami CDISC. Workflow łączy trzy typy kroków: działania eksperta (człowiek), analizę przez agenta AI oraz deterministyczne skrypty Python/R.

workflow-plan.md
13 KB
﻿
# HITL Workflow: Walidacja danych klinicznych CDISC

## Cel projektu

Demo workflow Human-in-the-Loop (HITL) do walidacji danych z badań klinicznych zgodnie ze standardami CDISC. Workflow łączy trzy typy kroków: działania eksperta (człowiek), analizę przez agenta AI oraz deterministyczne skrypty Python/R.

**Zbiór danych demo:** CDISCPILOT01 — badanie kliniczne choroby Alzheimera (Xanomeline TTS, n=306)  
**Źródło danych:** [RConsortium/submissions-pilot3-adam-to-fda](https://github.com/RConsortium/submissions-pilot3-adam-to-fda) — pełny pakiet SDTM + ADaM + Define.xml  
**Silnik walidacyjny:** [CDISC CORE Rules Engine](https://github.com/cdisc-org/cdisc-rules-engine)

---

## Diagram przepływu

```
[CZŁOWIEK] ──► [SKRYPT] ──► [CZŁOWIEK] ──► [AGENT] ──► [SKRYPT] ──► [AGENT] ──► [CZŁOWIEK] ──► [AGENT] ──► [SKRYPT]
   Krok 1        Krok 2        Krok 3        Krok 4       Krok 5       Krok 6       Krok 7        Krok 8      Krok 9
```

---

## Kroki workflow

### Krok 1 — [CZŁOWIEK] Konfiguracja sesji walidacji

Ekspert ds. danych klinicznych konfiguruje parametry sesji walidacji przed wgraniem danych.

**Akcje:**
- Wybór standardu danych: `SDTM` / `ADaM` / `SEND`
- Wybór wersji Implementation Guide (np. SDTMIG 3.4, ADaMIG 1.3)
- Wybór zestawu reguł regulacyjnych: `CDISC Core` / `FDA` / `PMDA` / `wszystkie`
- Opcjonalnie: wgranie pliku `define.xml` jako kontekstu metadanych
- Opcjonalnie: wybór trybu demo (aktywuje wstrzyknięcie błędów w kroku 2)

**Wyjście:** plik konfiguracyjny sesji `session_config.json`

**Uzasadnienie dla specjalistów:** Dobór zestawu reguł do docelowego regulatora (FDA vs. PMDA vs. EMA) to pierwsza decyzja eksperta w prawdziwym procesie submission — workflow ją odzwierciedla.

---

### Krok 2 — [SKRYPT Python] Pre-flight check i opcjonalne wstrzyknięcie błędów

Automatyczna weryfikacja techniczna pliku przed właściwą walidacją.

**Akcje:**
- Sprawdzenie formatu pliku (SAS XPORT V5 vs V8, Dataset-JSON v1.0)
- Weryfikacja integralności XPT: poprawność nagłówka, długości rekordów, enkodowania
- Ekstrakcja podstawowych metadanych: lista domen, liczba obserwacji, zmiennych, zakres dat
- Sprawdzenie kompletności paczki: czy obecne są wszystkie wymagane domeny dla wybranego standardu (np. `DM`, `AE`, `EX` dla SDTM)
- **[TRYB DEMO]** Jeśli aktywny: wstrzyknięcie kontrolowanych naruszeń do kopii danych:
  - `SD0003` — zepsuta data ISO w `LBDTC` (np. `"15MAR2020"` zamiast `"2020-03-15"`)
  - `SD0005` — duplikat pary `USUBJID` + `--SEQ` w `LB`
  - `SD0018` — `LBTESTCD` przekraczający 8 znaków
  - `CT2xxx` — niedozwolona wartość `SEX` poza CDISC CT
  - `AD0196` — brak `AVALU` przy wypełnionym `AVAL` w ADaM

**Wyjście:** raport pre-flight `preflight_report.json`, ścieżka do pliku (oryginalnego lub z błędami) przekazana do kolejnego kroku

**Uzasadnienie:** Błędy techniczne formatu XPT uniemożliwiają uruchomienie silnika CORE — pre-flight oddziela problemy techniczne od merytorycznych naruszeń reguł CDISC.

---

### Krok 3 — [CZŁOWIEK] Przegląd pre-flight i zatwierdzenie do walidacji

Ekspert przegląda raport techniczny i podejmuje decyzję o kontynuowaniu.

**Akcje:**
- Weryfikacja listy domen i metadanych — czy paczka jest kompletna?
- Akceptacja lub odrzucenie pliku (np. jeśli brakuje kluczowych domen)
- Opcjonalnie: dodanie komentarza do sesji (np. znane ograniczenia danych)
- Zatwierdzenie: `Uruchom walidację` / `Odrzuć i wgraj ponownie`

**Uzasadnienie:** Sponsor lub biostatystyk musi świadomie zatwierdzić, że przekazuje właściwy pakiet — to wymóg audytu w procesach 21 CFR Part 11.

---

### Krok 4 — [AGENT AI] Uruchomienie CDISC CORE Rules Engine i walidacja

Agent wykonuje walidację przy użyciu silnika CDISC CORE.

**Akcje:**
- Uruchomienie `cdisc-rules-engine` z parametrami z `session_config.json`
- Przekazanie ścieżki do pliku XPT oraz ścieżki do `define.xml` (jeśli dostępny)
- Monitorowanie postępu walidacji (CORE może przetwarzać reguły równolegle)
- Zebranie surowego wyjścia JSON z wynikami naruszeń reguł
- Logowanie metadanych wykonania: czas, wersja silnika, liczba sprawdzonych reguł

**Przykładowe wywołanie:**
```bash
cdisc_rules_engine validate \
  --dataset-path ./data/lb.xpt \
  --define-xml ./data/define.xml \
  --standard sdtm \
  --version 3.4 \
  --rules-engine-version latest \
  --output ./output/raw_results.json
```

**Wyjście:** `raw_results.json` — surowe wyniki walidacji ze szczegółami każdego naruszenia

---

### Krok 5 — [SKRYPT Python] Strukturyzacja i wzbogacenie wyników

Deterministyczna transformacja surowego wyjścia do analizowalnej struktury.

**Akcje:**
- Parsowanie `raw_results.json` do tabularycznej struktury danych
- Mapowanie kodów reguł na kategorie: `Structure` / `Controlled Terminology` / `Consistency` / `FDA Business Rules` / `PMDA`
- Przypisanie poziomów krytyczności: `Critical` (blokuje submission) / `Major` / `Minor` / `Warning`
- Agregacja statystyk: liczba naruszeń per domena, per kategoria, per reguła
- Identyfikacja naruszeń blokujących FDA Technical Rejection Criteria (TRC)
- Wygenerowanie macierzy heatmap: domeny × kategorie reguł

**Wyjście:** `structured_findings.parquet`, `findings_summary.json`, `heatmap_data.json`

**Uzasadnienie:** CORE generuje płaski JSON — transformacja do struktury wielowymiarowej jest deterministyczna i powinna być wersjonowalna (skrypt R/Python w repozytorium projektu).

---

### Krok 6 — [AGENT AI] Analiza wyników i przygotowanie raportu

Agent interpretuje wyniki walidacji w kontekście klinicznym i regulacyjnym.

**Akcje:**
- Analiza wzorców naruszeń: które domeny mają największe ryzyko, jakie typy błędów dominują
- Identyfikacja naruszeń krytycznych z perspektywy FDA TRC (Technical Rejection Criteria) — pliki które mogą skutkować odrzuceniem submission bez przeglądu merytorycznego
- Ocena wpływu na integralność danych klinicznych (np. błędy datowania w `AE` vs. błędy etykiet w `LB`)
- Zestawienie wyników z benchmarkiem: porównanie z profilem walidacyjnym czystego Pilot 3 (baseline)
- Sformułowanie priorytetów remediacji z uzasadnieniem regulacyjnym
- Wygenerowanie raportu w trzech warstwach:
  - **Executive Summary** (1 strona) — dla kierownictwa projektu
  - **Findings Detail** — tabela wszystkich naruszeń z kontekstem
  - **Remediation Checklist** — lista zadań dla data managera z opisem poprawek

**Wyjście:** `validation_report_draft.html`, `remediation_checklist.md`

---

### Krok 7 — [CZŁOWIEK] Triage wyników — weryfikacja ekspercka

Ekspert kliniczny lub data manager przegląda wyniki i klasyfikuje każde naruszenie.

**Akcje:**
- Weryfikacja każdego znaleziska: rzeczywiste naruszenie vs. false positive
- Klasyfikacja naruszeń:
  - `Confirmed` — wymaga korekty w danych
  - `Waived` — akceptowalne odchylenie z uzasadnieniem (np. starsza wersja CT)
  - `False Positive` — błędna interpretacja przez silnik (zgłoszenie do CDISC)
  - `Out of Scope` — nie dotyczy tego badania
- Przypisanie właścicieli zadań remediacyjnych
- Dodanie komentarzy eksperckich do poszczególnych findings (zapisywane do audit trail)
- Opcjonalnie: oznaczenie naruszeń do eskalacji do Data Safety Monitoring Board (DSMB)

**Wyjście:** `triage_annotations.json` z decyzjami i komentarzami eksperta

**Uzasadnienie:** Ludzka weryfikacja jest wymagana procesowo — silnik walidacyjny nie zna kontekstu protokołu badania. Expert waiver jest standardową praktyką w submission package.

---

### Krok 8 — [AGENT AI] Finalizacja raportu z uwzględnieniem triage

Agent integruje decyzje eksperta i generuje finalną wersję raportu.

**Akcje:**
- Połączenie `validation_report_draft.html` z `triage_annotations.json`
- Aktualizacja statusów wszystkich findings zgodnie z decyzjami eksperta
- Generowanie sekcji Audit Trail: kto, co, kiedy zatwierdził/odrzucił
- Wyliczenie finalnych metryk: liczba `Confirmed` naruszeń wymagających korekty, liczba `Waived`, procent zgodności z wybranym standardem
- Przygotowanie wersji raportu gotowej do dołączenia do submission package (ADRG-compatible)
- Porównanie z poprzednimi sesjami walidacyjnymi (jeśli dostępne) — trend: nowe/rozwiązane naruszenia

**Wyjście:** `validation_report_final.html`, `validation_report_final.pdf`, `audit_trail.json`

---

### Krok 9 — [SKRYPT Python] Archiwizacja i generowanie artefaktów submission

Deterministyczne zamknięcie sesji i przygotowanie artefaktów do archiwum.

**Akcje:**
- Zapis wszystkich artefaktów sesji do struktury katalogów zgodnej z eCTD:
  ```
  submission/
  ├── m5/datasets/{study}/tabulations/sdtm/
  ├── validation/
  │   ├── session_config.json
  │   ├── preflight_report.json
  │   ├── raw_results.json
  │   ├── structured_findings.parquet
  │   ├── triage_annotations.json
  │   ├── audit_trail.json
  │   ├── validation_report_final.pdf
  │   └── remediation_checklist.md
  ```
- Wygenerowanie manifestu SHA-256 wszystkich plików (integralność archiwum)
- Zapis metadanych sesji: wersja CORE, daty wykonania, identyfikatory użytkowników
- Opcjonalnie: push do systemu zarządzania dokumentacją (Veeva Vault, SharePoint)
- Generowanie statusu `READY_FOR_SUBMISSION` / `REMEDIATION_REQUIRED` / `REJECTED`

**Wyjście:** archiwum ZIP z pełną dokumentacją sesji walidacyjnej, gotowe do przekazania do regulatory affairs

---

## Podsumowanie kroków

| # | Krok | Typ | Wejście | Wyjście |
|---|------|-----|---------|---------|
| 1 | Konfiguracja sesji | **Człowiek** | — | `session_config.json` |
| 2 | Pre-flight check + błędy demo | **Skrypt Python** | XPT / Dataset-JSON | `preflight_report.json` |
| 3 | Zatwierdzenie do walidacji | **Człowiek** | `preflight_report.json` | decyzja GO/NO-GO |
| 4 | Uruchomienie CDISC CORE | **Agent AI** | XPT, `define.xml`, config | `raw_results.json` |
| 5 | Strukturyzacja wyników | **Skrypt Python** | `raw_results.json` | `structured_findings.parquet` |
| 6 | Analiza i raport draft | **Agent AI** | wyniki strukturyzowane | `validation_report_draft.html` |
| 7 | Triage ekspercki | **Człowiek** | raport draft | `triage_annotations.json` |
| 8 | Finalizacja raportu | **Agent AI** | raport + triage | `validation_report_final.pdf` |
| 9 | Archiwizacja | **Skrypt Python** | wszystkie artefakty | archiwum eCTD-compatible |

---

## Scenariusz demo (krok po kroku)

1. **Stan bazowy:** Wgranie czystego pakietu Pilot 3 (`dm.xpt`, `lb.xpt`, `ae.xpt`, `define.xml`) → walidacja przechodzi z zerową liczbą `Confirmed` naruszeń
2. **Wstrzyknięcie błędów:** Aktywacja trybu demo w kroku 1 → skrypt w kroku 2 wstrzykuje 5 kontrolowanych naruszeń
3. **Walidacja z błędami:** CORE wykrywa naruszenia → agent generuje raport z priorytetami
4. **Triage:** Ekspert oznacza jedno naruszenie jako `Waived` (stara wersja CT), resztę jako `Confirmed`
5. **Raport finalny:** Agent generuje dokument gotowy do submission z pełnym audit trail

---

## Technologie i zależności

| Komponent | Technologia |
|-----------|-------------|
| CDISC CORE Rules Engine | Python (`cdisc-rules-engine` CLI) |
| Wstrzyknięcie błędów | Python (`pandas`, `xport`) lub R (`haven`, `xportr`) |
| Strukturyzacja wyników | Python (`pandas`, `pyarrow`) |
| Agent AI | Claude API (Anthropic) — narzędzia: bash, file read/write |
| Raport HTML/PDF | Python (`jinja2`, `weasyprint`) lub R (`rmarkdown`, `knitr`) |
| Frontend HITL | do ustalenia: Shiny / Streamlit / Next.js |
| Archiwum | Python (`zipfile`, `hashlib`) |

---

## Otwarte pytania do kolejnego etapu

- Jaki interfejs użytkownika dla kroków człowieka? (webowy, desktopowy, CLI?)
- Czy agent w kroku 4 ma tylko wywoływać CORE CLI, czy też samodzielnie interpretować reguły YAML z repozytorium `cdisc-open-rules`?
- Czy raport finalny ma być zgodny z formatem ADRG (Analysis Data Reviewer's Guide)?
- Obsługa wielu plików XPT jednocześnie (pełna paczka SDTM = 21 domen) vs. walidacja pojedynczego pliku?
- Wersjonowanie sesji walidacyjnych i porównanie run-to-run (ważne w iteracyjnym procesie data cleaning)?
workflow-plan.md
13 KB

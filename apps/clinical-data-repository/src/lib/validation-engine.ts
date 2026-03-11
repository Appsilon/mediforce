import type { ValidationIssue, ValidationRule } from './types';
import { validationRules as defaultRules } from './demo-data';

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?$/;
const VALID_SEX_VALUES = new Set(['M', 'F', 'UN']);
const VALID_AESER_VALUES = new Set(['Y', 'N']);
const VALID_AESEV_VALUES = new Set(['MILD', 'MODERATE', 'SEVERE']);

export function validateDmDomain(
  rows: Record<string, string>[],
  fileId: string,
  fileName: string,
  rules: ValidationRule[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const enabledRules = new Set(rules.filter((r) => r.enabled).map((r) => r.id));

  rows.forEach((row, index) => {
    const rowNum = index + 1;

    if (enabledRules.has('GENERAL.REQUIRED') || enabledRules.has('SDTM.DM.RFSTDTC')) {
      if (row['RFSTDTC'] === '' || row['RFSTDTC'] === undefined) {
        issues.push({
          id: `dyn-dm-rfstdtc-missing-${rowNum}`,
          severity: 'Error',
          fileId,
          fileName,
          domain: 'DM',
          variable: 'RFSTDTC',
          row: rowNum,
          description: `Required variable RFSTDTC is missing for subject ${row['USUBJID'] ?? 'unknown'}`,
          ruleId: 'GENERAL.REQUIRED',
          cellValue: '',
        });
      } else if (enabledRules.has('SDTM.DATES') && !ISO_DATE_REGEX.test(row['RFSTDTC'])) {
        issues.push({
          id: `dyn-dm-rfstdtc-format-${rowNum}`,
          severity: 'Error',
          fileId,
          fileName,
          domain: 'DM',
          variable: 'RFSTDTC',
          row: rowNum,
          description: `Date format "${row['RFSTDTC']}" does not conform to ISO 8601`,
          ruleId: 'SDTM.DATES',
          cellValue: row['RFSTDTC'],
        });
      }
    }

    if (enabledRules.has('SDTM.DM.SEX') && row['SEX'] !== '' && !VALID_SEX_VALUES.has(row['SEX'])) {
      issues.push({
        id: `dyn-dm-sex-${rowNum}`,
        severity: 'Error',
        fileId,
        fileName,
        domain: 'DM',
        variable: 'SEX',
        row: rowNum,
        description: `Invalid SEX value "${row['SEX']}" — must be M, F, or UN per CDISC CT`,
        ruleId: 'SDTM.DM.SEX',
        cellValue: row['SEX'],
      });
    }

    if (enabledRules.has('SDTM.DM.AGE') && (row['AGE'] === '' || row['AGE'] === undefined)) {
      issues.push({
        id: `dyn-dm-age-missing-${rowNum}`,
        severity: 'Warning',
        fileId,
        fileName,
        domain: 'DM',
        variable: 'AGE',
        row: rowNum,
        description: `Required variable AGE is missing for subject ${row['USUBJID'] ?? 'unknown'}`,
        ruleId: 'SDTM.DM.AGE',
        cellValue: '',
      });
    } else if (enabledRules.has('CUSTOM.AGERANGE') && row['AGE'] !== '') {
      const age = Number(row['AGE']);
      if (!isNaN(age) && (age < 18 || age > 80)) {
        issues.push({
          id: `dyn-dm-age-range-${rowNum}`,
          severity: 'Error',
          fileId,
          fileName,
          domain: 'DM',
          variable: 'AGE',
          row: rowNum,
          description: `Subject age ${age} is outside protocol-defined range 18–80`,
          ruleId: 'CUSTOM.AGERANGE',
          cellValue: row['AGE'],
        });
      }
    }
  });

  return issues;
}

export function validateAeDomain(
  rows: Record<string, string>[],
  fileId: string,
  fileName: string,
  rules: ValidationRule[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const enabledRules = new Set(rules.filter((r) => r.enabled).map((r) => r.id));

  rows.forEach((row, index) => {
    const rowNum = index + 1;

    if (enabledRules.has('GENERAL.REQUIRED') && (row['AEDECOD'] === '' || row['AEDECOD'] === undefined)) {
      issues.push({
        id: `dyn-ae-aedecod-${rowNum}`,
        severity: 'Error',
        fileId,
        fileName,
        domain: 'AE',
        variable: 'AEDECOD',
        row: rowNum,
        description: 'Required variable AEDECOD (Adverse Event Decoded Term) is missing',
        ruleId: 'GENERAL.REQUIRED',
        cellValue: '',
      });
    }

    if (enabledRules.has('SDTM.AE.AESER') && row['AESER'] !== '' && !VALID_AESER_VALUES.has(row['AESER'])) {
      issues.push({
        id: `dyn-ae-aeser-${rowNum}`,
        severity: 'Error',
        fileId,
        fileName,
        domain: 'AE',
        variable: 'AESER',
        row: rowNum,
        description: `Invalid AESER value "${row['AESER']}" — must be Y or N per CDISC CT`,
        ruleId: 'SDTM.AE.AESER',
        cellValue: row['AESER'],
      });
    }

    if (enabledRules.has('SDTM.AE.AESEV') && row['AESEV'] !== '' && !VALID_AESEV_VALUES.has(row['AESEV'])) {
      issues.push({
        id: `dyn-ae-aesev-${rowNum}`,
        severity: 'Warning',
        fileId,
        fileName,
        domain: 'AE',
        variable: 'AESEV',
        row: rowNum,
        description: `Invalid AESEV value "${row['AESEV']}" — must be MILD, MODERATE, or SEVERE`,
        ruleId: 'SDTM.AE.AESEV',
        cellValue: row['AESEV'],
      });
    }

    if (enabledRules.has('SDTM.DATES') && row['AEENDTC'] !== '') {
      const endDate = new Date(row['AEENDTC']);
      if (!isNaN(endDate.getTime()) && endDate > new Date()) {
        issues.push({
          id: `dyn-ae-future-date-${rowNum}`,
          severity: 'Warning',
          fileId,
          fileName,
          domain: 'AE',
          variable: 'AEENDTC',
          row: rowNum,
          description: `AE end date "${row['AEENDTC']}" is in the future — possible data entry error`,
          ruleId: 'SDTM.DATES',
          cellValue: row['AEENDTC'],
        });
      }
    }
  });

  return issues;
}

export function runValidation(
  rows: Record<string, string>[],
  domain: string,
  fileId: string,
  fileName: string,
  rules: ValidationRule[] = defaultRules
): ValidationIssue[] {
  if (domain === 'DM') {
    return validateDmDomain(rows, fileId, fileName, rules);
  }
  if (domain === 'AE') {
    return validateAeDomain(rows, fileId, fileName, rules);
  }
  return [];
}

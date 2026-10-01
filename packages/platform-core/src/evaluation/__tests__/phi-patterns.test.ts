import { describe, it, expect } from 'vitest';
import { findPhi } from '../phi-patterns';

describe('findPhi', () => {
  it('names the kinds of identifier in a text and finds none in clinical prose', () => {
    expect(findPhi('Subject 01-001, SSN 123-45-6789, reach at jane.doe@example.com or (555) 123-4567, MRN: A1234567, DOB 1961-04-02'))
      .toEqual(['social security number', 'email address', 'phone number', 'medical record number', 'date of birth']);
    expect(findPhi('Sepsis, CTCAE grade 5, onset 2014-01-02, 12 mg/kg, USUBJID 01-701-1015')).toEqual([]);
  });
});

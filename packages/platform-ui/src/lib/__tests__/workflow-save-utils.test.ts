import { describe, it, expect } from 'vitest';
import { formatSaveErrorMessage } from '../workflow-save-utils';

describe('formatSaveErrorMessage', () => {
  it('points to the diagram when there are step errors', () => {
    expect(formatSaveErrorMessage(new Error('anything'), true)).toBe(
      'Some steps have errors — check the highlighted steps in the diagram.',
    );
  });

  it('translates a Zod "too small" message to plain English', () => {
    const err = new Error('String must contain at least 1 character(s)');
    expect(formatSaveErrorMessage(err, false)).toBe('A required field is empty or missing.');
  });

  it('translates a Zod "expected / received" message to plain English', () => {
    const err = new Error("Invalid enum value. Expected 'creation' | 'review', received 'foo'");
    expect(formatSaveErrorMessage(err, false)).toBe('A field has an invalid value.');
  });

  it('translates a standalone Zod type-mismatch message to plain English', () => {
    const err = new Error('Expected number, received string');
    expect(formatSaveErrorMessage(err, false)).toBe('A field has an invalid value.');
  });

  it('passes prose that merely contains "must contain at least" through unchanged', () => {
    const err = new Error('The selected roles must contain at least one admin.');
    expect(formatSaveErrorMessage(err, false)).toBe(err.message);
  });

  it('passes prose that merely contains "invalid enum value" through unchanged', () => {
    const err = new Error('The submitted payload had an invalid enum value in the type field.');
    expect(formatSaveErrorMessage(err, false)).toBe(err.message);
  });

  it('replaces a raw JSON envelope with a friendly message', () => {
    const err = new Error('{"error":{"code":"validation","message":"Invalid input"}}');
    expect(formatSaveErrorMessage(err, false)).toBe(
      'The workflow could not be saved. Please check your inputs and try again.',
    );
  });

  it('passes a human-readable server message through unchanged', () => {
    const err = new Error('The name "x" was previously used by a deleted workflow. Please choose a different name.');
    expect(formatSaveErrorMessage(err, false)).toBe(err.message);
  });

  it('falls back to a generic message when the error has no message', () => {
    expect(formatSaveErrorMessage(new Error(''), false)).toBe(
      'Unable to save the workflow. Please try again.',
    );
    expect(formatSaveErrorMessage({}, false)).toBe(
      'Unable to save the workflow. Please try again.',
    );
  });

  it('does not treat text that merely contains braces as JSON', () => {
    const err = new Error('Step {name} is required');
    expect(formatSaveErrorMessage(err, false)).toBe('Step {name} is required');
  });

  it('passes a human message containing "too small" through unchanged', () => {
    const err = new Error('The batch window is too small to fit the requested runs.');
    expect(formatSaveErrorMessage(err, false)).toBe(err.message);
  });

  it('passes prose with lowercase "expected ... received" through unchanged', () => {
    const err = new Error('We expected the report, but received nothing from the upstream service.');
    expect(formatSaveErrorMessage(err, false)).toBe(err.message);
  });
});

export { ActionRegistry, UnknownActionKindError } from './registry.js';
export { interpolate, getPath } from './interpolation.js';
export { httpActionHandler, type HttpActionOutput } from './handlers/http.js';
export { reshapeActionHandler } from './handlers/reshape.js';
export { createEmailActionHandler, type EmailActionOutput, type SendEmailFn, type EmailRateLimitConfig } from './handlers/email.js';
export type {
  ActionConfig,
  ActionContext,
  ActionOutput,
  ActionHandler,
  AnyActionHandler,
  HttpActionHandler,
  ReshapeActionHandler,
  EmailActionHandler,
  InterpolationSources,
} from './types.js';

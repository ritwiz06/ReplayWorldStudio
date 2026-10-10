// Runtime validation of untrusted JSON against the generated contract schema.
// Types and schema are both generated from the Pydantic models; see scripts/contracts.mjs.
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import bundle from "../schema/contracts.schema.json";
import type {
  HealthResponse,
  Project,
  ValidationErrorResponse,
  ValidationReport,
} from "./generated/contracts";

export type * from "./generated/contracts";

export const SCHEMA_VERSION: Project["schema_version"] = "0.1.0";

/** One structural problem, located by a JSON Pointer such as `/scene/objects/2/dimensions`. */
export interface ContractIssue {
  path: string;
  message: string;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: ContractIssue[] };

const ajv = new Ajv2020({ allErrors: true, strict: true, discriminator: true });
ajv.addSchema(bundle);

function validatorFor<T>(name: string): (data: unknown) => ValidationResult<T> {
  const validate: ValidateFunction<T> | undefined = ajv.getSchema<T>(
    `${bundle.$id}#/$defs/${name}`,
  );
  if (!validate) throw new Error(`Contract schema has no definition named ${name}`);
  return (data) =>
    validate(data) ? { ok: true, value: data } : { ok: false, issues: toIssues(validate.errors) };
}

function toIssues(errors: ErrorObject[] | null | undefined): ContractIssue[] {
  return (errors ?? []).map((e) => ({
    path: e.instancePath || "/",
    message:
      e.keyword === "additionalProperties"
        ? `unexpected property '${String(e.params.additionalProperty)}'`
        : (e.message ?? e.keyword),
  }));
}

/**
 * Structural checks only (types, required fields, units, ranges, closed objects).
 * Cross-field rules such as unique IDs are enforced by the API's Pydantic models.
 */
export const validateProject = validatorFor<Project>("Project");
export const validateHealthResponse = validatorFor<HealthResponse>("HealthResponse");
export const validateValidationReport = validatorFor<ValidationReport>("ValidationReport");
export const validateValidationErrorResponse =
  validatorFor<ValidationErrorResponse>("ValidationErrorResponse");

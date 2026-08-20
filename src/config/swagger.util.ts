/**
 * Swagger/OpenAPI docs are served ONLY in local development. Staging and
 * production return 404 — the full API map is not something a deployed
 * environment should hand out. (Security decision, MxH-0076 finding #4.)
 */
export function shouldExposeDocs(nodeEnv: string | undefined): boolean {
  return nodeEnv === 'development';
}

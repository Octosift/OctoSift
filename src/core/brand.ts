/**
 * The product name, version and home, kept in one place so the project can be
 * renamed or released with a single change here and in package.json. A test
 * keeps the version equal to the one in package.json.
 */
export const BRAND = Object.freeze({
  name: 'Octosift',
  tagline: 'Find people on Reddit who need what you built, and reply with something useful.',
  version: '0.1.0',
  /** The GitHub repository, as owner/name. */
  repository: 'Octosift/OctoSift',
});

export const REPOSITORY_URL = `https://github.com/${BRAND.repository}`;

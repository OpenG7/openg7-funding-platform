import { readFileSync } from 'node:fs';

// Read contracts from their domain owners; consumers still import the public facade.
export const readFundingCoreSource = (...modules) =>
  modules
    .map((module) =>
      readFileSync(`packages/funding-core/src/${module}.ts`, 'utf8')
    )
    .join('\n');

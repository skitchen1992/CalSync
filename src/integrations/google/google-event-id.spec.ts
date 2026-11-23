import { toGoogleEventId } from './google-event-id.js';

const SEED = '0b6a3f4e-6d1c-4a63-9f37-5c3d4b7f2a10:c5d7bcd7-8e19-47ec-b5f1-e8b624d12547@events-38194026';

describe('toGoogleEventId', () => {
  it('is deterministic', () => {
    expect(toGoogleEventId(SEED)).toBe(toGoogleEventId(SEED));
  });

  it('uses only base32hex characters and a length Google accepts', () => {
    const id = toGoogleEventId(SEED);

    expect(id).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(id).toHaveLength(52);
  });

  it('differs for different seeds', () => {
    expect(toGoogleEventId(`${SEED}-other`)).not.toBe(toGoogleEventId(SEED));
  });
});

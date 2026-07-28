import * as THREE from 'three';

/**
 * The look.
 *
 * World of Warcraft is not a lighting model, it is a painting convention: light
 * information is baked into the albedo, shading is banded rather than smooth,
 * shadows go COOL and saturated instead of dark, and every surface carries a
 * rim so silhouettes read against each other at distance. Physically-based
 * shading actively fights all four, so this is a hand-rolled ramp shader rather
 * than MeshStandardMaterial with the roughness pushed up.
 *
 * Three bands, not two: pure cel reads as Borderlands. WoW's terrain has a soft
 * mid-band, and that band is most of what makes it look painted.
 */

const COMMON = /* glsl */ `
  varying vec3 vN;
  varying vec3 vW;
  varying vec3 vC;
  varying float vAo;
`;

const VERT = /* glsl */ `
  ${COMMON}
  attribute vec3 tint;
  attribute float ao;
  void main() {
    vN = normalize(normalMatrix * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vC = tint;
    vAo = ao;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAG = /* glsl */ `
  ${COMMON}
  uniform vec3 uSunDir;
  uniform vec3 uSunCol;
  uniform vec3 uSkyCol;
  uniform vec3 uGroundCol;
  uniform vec3 uShadowTint;
  uniform vec3 uRimCol;
  uniform vec3 uFogCol;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec3 uCam;

  void main() {
    vec3 N = normalize(vN);
    float ndl = dot(N, normalize(uSunDir));

    // Three-band ramp. The wide soft middle is the painted look; hard two-tone
    // cel shading reads as a completely different genre.
    float lit  = smoothstep(0.02, 0.16, ndl);
    float mid  = smoothstep(-0.35, 0.05, ndl);
    float band = 0.34 + 0.30 * mid + 0.36 * lit;

    // Hemispheric ambient: sky above, warm dirt bounce below. This is what
    // keeps shadowed faces coloured rather than merely dark.
    float up = N.y * 0.5 + 0.5;
    vec3 ambient = mix(uGroundCol, uSkyCol, up);

    // Shadow side drifts toward saturated blue-violet instead of black.
    vec3 shade = mix(uShadowTint, vec3(1.0), band);

    vec3 col = vC * (ambient * 0.55 + uSunCol * band * 0.85) * shade;
    col *= mix(0.72, 1.0, vAo);

    // Rim. Silhouette separation is doing a lot of work in a scene that is
    // 1600 near-identical houses.
    vec3 V = normalize(uCam - vW);
    float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * smoothstep(-0.2, 0.5, ndl);
    col += uRimCol * rim * 0.5;

    // Coloured aerial perspective, not a grey wash.
    float d = length(uCam - vW);
    col = mix(col, uFogCol, smoothstep(uFogNear, uFogFar, d));

    // Filmic knee. The first pass used a 0.72 shoulder with a 1.35 gain, which
    // lifted midtones so hard that dark shingle browns landed on top of the
    // stucco wall tones and the whole street rendered as one flat orange mass.
    // A higher shoulder keeps the toe dark so roofs stay separated from walls.
    col = col / (col + 1.05) * 1.85;

    // Push saturation back after the knee — tonemapping always desaturates,
    // and this palette lives or dies on colour separation rather than value.
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(lum), col, 1.28);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export const PALETTE = {
  sun: new THREE.Color('#ffe6b8').multiplyScalar(1.15),
  sky: new THREE.Color('#8fc4ff'),
  ground: new THREE.Color('#b08a63'),
  shadowTint: new THREE.Color('#7d8bd6'),
  rim: new THREE.Color('#ffdca8'),
  fog: new THREE.Color('#bcd8f0'),
};

export function makeMaterial({ fogNear = 130, fogFar = 900 } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0.42, 0.78, 0.33).normalize() },
      uSunCol: { value: PALETTE.sun.clone() },
      uSkyCol: { value: PALETTE.sky.clone() },
      uGroundCol: { value: PALETTE.ground.clone() },
      uShadowTint: { value: PALETTE.shadowTint.clone() },
      uRimCol: { value: PALETTE.rim.clone() },
      uFogCol: { value: PALETTE.fog.clone() },
      uFogNear: { value: fogNear },
      uFogFar: { value: fogFar },
      uCam: { value: new THREE.Vector3() },
    },
  });
}

/** Stylised sky dome: banded gradient, no atmospheric scattering. */
export function makeSky() {
  const g = new THREE.SphereGeometry(2600, 24, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color('#4f9be8') },
      uMid: { value: new THREE.Color('#a9d6f5') },
      uHaze: { value: new THREE.Color('#e6eef2') },
    },
    vertexShader: `
      varying vec3 vP;
      void main() {
        vP = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vP;
      uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHaze;
      void main() {
        float h = normalize(vP).y;
        vec3 c = mix(uHaze, uMid, smoothstep(-0.02, 0.28, h));
        c = mix(c, uTop, smoothstep(0.18, 0.75, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Suburban palettes. Real Texas subdivisions are a narrow band of tans, stucco
 * creams and brick reds, which is exactly why they need saturating for this
 * style — sampled literally they render as grey mush.
 */
/*
 * A real Texas subdivision is a narrow band of tan stucco and red brick. Sampled
 * literally that is one hue across 1,500 houses, which is why the first pass
 * read as an orange smear. The range is widened here — sages, cool greys, a few
 * brick reds — which is the same liberty the reference art direction takes with
 * real-world materials.
 */
export const HOUSE_COLORS = [
  '#d9b892', '#c8a074', '#e0c9a6', '#b98d6a', '#cf9f7d',
  '#a8a189', '#8f9c8a', '#b5b2a4', '#9d8f7e', '#c2b49c',
  '#b0705a', '#a35d4c', '#cc9a86', '#8c6f63', '#d7c4ae',
].map((h) => new THREE.Color(h));

/** Deliberately much darker than the walls — roof/wall contrast is most of
 *  what makes a row of houses read as separate objects at distance. */
export const ROOF_COLORS = [
  '#3b2f2a', '#463731', '#2f2724', '#523f36', '#38302c',
  '#4a3a42', '#5a3b32', '#333a3d',
].map((h) => new THREE.Color(h));

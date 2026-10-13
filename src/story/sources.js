// The sources cited in story and About copy, in order of first appearance.
// Every entry comes from docs/science.md (sections 1, 4, 5, 6); the key is science.md's citation key.

export const SOURCES = [
  { key: 'WardReddy2020', ref: 'Ward, C.P., Reddy, C.M. (2020). Opinion: We need better data about the environmental persistence of plastic goods. PNAS 117(26), 14618–14621.', url: 'https://doi.org/10.1073/pnas.2008009117' },
  { key: 'Ioakeimidis2016', ref: 'Ioakeimidis, C., et al. (2016). The degradation potential of PET bottles in the marine environment: An ATR-FTIR based approach. Scientific Reports 6, 23501.', url: 'https://doi.org/10.1038/srep23501' },
  { key: 'Song2017', ref: 'Song, Y.K., et al. (2017). Combined effects of UV exposure duration and mechanical abrasion on microplastic fragmentation by polymer type. Environ. Sci. Technol. 51(8), 4368–4376.', url: 'https://doi.org/10.1021/acs.est.6b06155' },
  { key: 'Onink2021', ref: 'Onink, V., Jongedijk, C.E., Hoffman, M.J., van Sebille, E., Laufkötter, C. (2021). Global simulations of marine plastic transport show plastic trapping in coastal zones. Environ. Res. Lett. 16, 064053.', url: 'https://doi.org/10.1088/1748-9326/abecbd' },
  { key: 'Maximenko2018', ref: 'Maximenko, N., Hafner, J., Kamachi, M., MacFadyen, A. (2018). Numerical simulations of debris drift from the Great Japan Tsunami of 2011 and their verification with observational reports. Mar. Pollut. Bull. 132, 5–25.', url: 'https://doi.org/10.1016/j.marpolbul.2018.03.056' },
  { key: 'Maximenko2012', ref: 'Maximenko, N., Hafner, J., Niiler, P. (2012). Pathways of marine debris derived from trajectories of Lagrangian drifters. Mar. Pollut. Bull. 65(1–3), 51–62.', url: 'https://doi.org/10.1016/j.marpolbul.2011.04.016' },
  { key: 'Lebreton2018', ref: 'Lebreton, L., Slat, B., Ferrari, F., et al. (2018). Evidence that the Great Pacific Garbage Patch is rapidly accumulating plastic. Scientific Reports 8, 4666.', url: 'https://doi.org/10.1038/s41598-018-22939-w' },
  { key: 'FazeyRyan2016', ref: 'Fazey, F.M.C., Ryan, P.G. (2016). Biofouling on buoyant marine plastics: An experimental study into the effect of size on surface longevity. Environmental Pollution 210, 354–360.', url: 'https://doi.org/10.1016/j.envpol.2016.01.026' },
  { key: 'Eriksen2014', ref: 'Eriksen, M., et al. (2014). Plastic pollution in the world’s oceans: More than 5 trillion plastic pieces weighing over 250,000 tons afloat at sea. PLoS ONE 9(12), e111913.', url: 'https://doi.org/10.1371/journal.pone.0111913' },
  { key: 'Barrett2020', ref: 'Barrett, J., Chase, Z., Zhang, J., et al. (2020). Microplastic pollution in deep-sea sediments from the Great Australian Bight. Front. Mar. Sci. 7, 576170.', url: 'https://doi.org/10.3389/fmars.2020.576170' },
  { key: 'Chiba2018', ref: 'Chiba, S., Saito, H., Fletcher, R., et al. (2018). Human footprint in the abyss: 30 year records of deep-sea plastic debris. Marine Policy 96, 204–212.', url: 'https://doi.org/10.1016/j.marpol.2018.03.022' },
  { key: 'Jamieson2019', ref: 'Jamieson, A.J., Brooks, L.S.R., Reid, W.D.K., et al. (2019). Microplastics and synthetic particles ingested by deep-sea amphipods in six of the deepest marine ecosystems on Earth. R. Soc. Open Sci. 6, 180667.', url: 'https://doi.org/10.1098/rsos.180667' },
  { key: 'Wilcox2015', ref: 'Wilcox, C., Van Sebille, E., Hardesty, B.D. (2015). Threat of plastic pollution to seabirds is global, pervasive, and increasing. PNAS 112(38), 11899–11904.', url: 'https://doi.org/10.1073/pnas.1502108112' },
  { key: 'Chamas2020', ref: 'Chamas, A., et al. (2020). Degradation rates of plastics in the environment. ACS Sustainable Chem. Eng. 8(9), 3494–3511.', url: 'https://doi.org/10.1021/acssuschemeng.9b06635' },
  { key: 'Poulain2009', ref: 'Poulain, P.-M., Gerin, R., Mauri, E., Pennel, R. (2009). Wind effects on drogued and undrogued drifters in the eastern Mediterranean. J. Atmos. Oceanic Technol. 26, 1144–1156.', url: 'https://doi.org/10.1175/2008JTECHO618.1' },
];

const index = new Map(SOURCES.map((s, i) => [s.key, i + 1]));

/** Inline citation: a small superscript link to the source list in the About scene. */
export function cite(...keys) {
  return keys.map((k) => {
    const n = index.get(k);
    if (!n) throw new Error(`unknown source ${k}`);
    return `<sup class="cite"><a href="#src-${n}" aria-label="Source ${n}">${n}</a></sup>`;
  }).join('<sup class="cite-sep">,</sup>');
}

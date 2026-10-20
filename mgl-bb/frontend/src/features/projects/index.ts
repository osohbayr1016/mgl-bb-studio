// Public surface of the projects feature. Cross-feature consumers should
// import from here (`@/features/projects`) rather than reaching into internal
// component paths. (Team-report exports are deferred until that area's
// in-flight work lands, then added here.)
export { ProjectInfoTab } from './components/ProjectInfoTab';
export { default as CorrespondenceLogTab } from './components/CorrespondenceLogTab';

import {normalize} from './identity.mjs';

// Corrections backed by a public platform page, rather than choosing the newest
// namesake by default. A correction only applies to its listed release and ID.
const confirmedFilms=[{
  title:'Dhoomakethu',id:'tt38990864',year:'2026',platform:'Netflix',
  ottReleaseDate:'2026-10-23',originalLanguages:['Q36236'],
  cast:['Nikhila Vimal','Shine Tom Chacko'],
  sourceName:'Netflix public title page',sourceUrl:'https://www.netflix.com/in/title/83206696',
  checkedAt:'2026-10-29',
}];

export function confirmedRelease(row) {
  return confirmedFilms.find(f=>normalize(row.title)===normalize(f.title)
    &&row.ottReleaseDate===f.ottReleaseDate&&row.platforms?.includes(f.platform)
    &&(!row.movieYearHint||row.movieYearHint===f.year));
}

export function confirmedIdentity(row,meta) {
  const film=confirmedRelease(row);
  if(!film||meta.id!==film.id||meta.year!==film.year||normalize(meta.name)!==normalize(film.title))return null;
  if(!meta.cast?.some(name=>film.cast.some(known=>normalize(name)===normalize(known))))return null;
  return film;
}

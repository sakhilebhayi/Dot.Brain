export async function searchGithubRepos(query) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=updated&per_page=10`;
  const response = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json' },
  });

  if (!response.ok) {
    throw new Error(`GitHub search failed for "${query}": HTTP ${response.status}`);
  }

  const body = await response.json();

  return (body.items ?? []).map((repo) => ({
    name: repo.name,
    fullName: repo.full_name,
    description: repo.description,
    url: repo.html_url,
    stars: repo.stargazers_count,
    updatedAt: repo.updated_at,
  }));
}

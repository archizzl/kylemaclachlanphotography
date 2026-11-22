# DNS before the cutover (2026-11-22)

Before blog-cdn took over `kylemaclachlanphotography.org`, the apex and `www` pointed at the Reaction Future Institute's GitHub Pages site (repo `reactionfutureinstitute.github.io`). These were the records, as seen from public DNS just before the cutover. To go back, delete the Worker custom domains (Workers & Pages → blog-cdn → Settings → Domains), then recreate these in the zone's DNS:

| type | name | content |
|---|---|---|
| A | kylemaclachlanphotography.org | 185.199.108.153 |
| A | kylemaclachlanphotography.org | 185.199.109.153 |
| A | kylemaclachlanphotography.org | 185.199.110.153 |
| A | kylemaclachlanphotography.org | 185.199.111.153 |
| CNAME | www | reactionfutureinstitute.github.io |

`cdn.kylemaclachlanphotography.org` had no records. It's now the R2 bucket `blog-cdn-files`.

The GitHub Pages site itself is unchanged and still reachable at https://reactionfutureinstitute.github.io/. Its repo still lists `kylemaclachlanphotography.org` as its custom domain. Remove that in the repo's Settings → Pages so GitHub stops expecting the domain.

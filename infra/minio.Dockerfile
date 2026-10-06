# Official historical images are unavailable. Build archived community source at an immutable commit.
FROM golang:1.26-bookworm@sha256:a688600ca24f8a4d3ca77f95b0dd40704a9fc787c826660eb7ba0b641b8b175d AS build
WORKDIR /src
ADD --checksum=sha256:71794c2df26aad0cc99e8421c58b7aa2dd55969f979b0e7d1e931042e9fabcd6 https://codeload.github.com/minio/minio/tar.gz/7aac2a2c5b7c882e68c1ce017d8256be2feea27f /tmp/source.tar.gz
RUN tar xzf /tmp/source.tar.gz --strip-components=1 && CGO_ENABLED=0 GOMAXPROCS=2 go build -p 2 -trimpath -o /minio .
FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895
COPY --from=build /minio /usr/local/bin/minio
COPY --from=build /src/LICENSE /usr/share/doc/minio/LICENSE
RUN mkdir -p /data && chown bun:bun /data
USER bun
EXPOSE 9000 9001
ENTRYPOINT ["minio"]

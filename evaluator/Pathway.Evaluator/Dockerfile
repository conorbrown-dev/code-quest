FROM mcr.microsoft.com/dotnet/sdk:10.0

RUN apt-get update && apt-get install -y --no-install-recommends bubblewrap python3 coreutils && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 runner && mkdir /workspace && chown runner:runner /workspace
WORKDIR /app
COPY Pathway.Evaluator.csproj ./
RUN dotnet restore --ignore-failed-sources
COPY . ./
RUN dotnet publish -c Release --no-restore -o /app/out
ENV ASPNETCORE_URLS=http://0.0.0.0:8080 \
    DOTNET_EnableDiagnostics=0
USER runner
EXPOSE 8080
ENTRYPOINT ["dotnet", "/app/out/Pathway.Evaluator.dll"]

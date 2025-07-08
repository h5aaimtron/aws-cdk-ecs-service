#See https://aka.ms/containerfastmode to understand how Visual Studio uses this Dockerfile to build your images for faster debugging.

FROM --platform=$TARGETPLATFORM mcr.microsoft.com/dotnet/aspnet:8.0 AS base
WORKDIR /app
EXPOSE 8080
EXPOSE 8081

FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:8.0 AS build
ARG TARGETARCH

# Fixes for NuGet restore issues
ENV DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1
ENV DOTNET_NUGET_SIGNATURE_VERIFICATION=false

WORKDIR /src

# Copy project file for better layer caching
COPY ["SampleApp/SampleApp.csproj", "SampleApp/"]

# Simple restore specifying target architecture
RUN dotnet restore "SampleApp/SampleApp.csproj" -a $TARGETARCH

# Copy remaining code
COPY . .
WORKDIR "/src/SampleApp"

# Build
RUN dotnet build "SampleApp.csproj" -c Release -o /app/build

FROM build AS publish
# Publish
RUN dotnet publish "SampleApp.csproj" -c Release -o /app/publish

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "SampleApp.dll"]
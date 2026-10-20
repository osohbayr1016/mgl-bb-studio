# Setup local D1 database with all migrations
# Usage: ./scripts/setup-local-db.ps1

# Өгөгдлийн сангийн нэрийг wrangler.toml-оос уншина — өөр компанид суулгахад
# энэ скриптийг гар аргаар засах шаардлагагүй.
$dbName = & node ./scripts/wranglerNames.mjs databaseName
if ($LASTEXITCODE -ne 0 -or -not $dbName) {
    Write-Host "❌ wrangler.toml-оос database_name уншиж чадсангүй" -ForegroundColor Red
    exit 1
}

Write-Host "🗄️  Setting up local D1 database '$dbName' with all migrations..." -ForegroundColor Cyan

# Get all migration files
$migrations = Get-ChildItem -Path "./migrations" -Filter "*.sql" -File | Sort-Object Name

foreach ($migration in $migrations) {
    $name = $migration.Name
    Write-Host "Applying $name..." -ForegroundColor Yellow

    & npx wrangler d1 execute $dbName --local --config wrangler.toml --file="./migrations/$name" 2>&1

    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ $name applied" -ForegroundColor Green
    } else {
        Write-Host "⚠️  $name failed (may already be applied)" -ForegroundColor Yellow
    }
}

Write-Host "`n✅ Local database setup complete!" -ForegroundColor Green
Write-Host "You can now login with: username='admin', password='admin123'" -ForegroundColor Green

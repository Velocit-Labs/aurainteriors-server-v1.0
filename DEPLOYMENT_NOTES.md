# Deployment Notes - Render Backend

## Key Environment Variables for Production

### Database
```env
MONGO_URI=your_production_mongodb_uri
```

### Authentication
```env
JWT_SECRET=use_a_strong_random_string
JWT_EXPIRES_IN=7d
JWT_COOKIE_EXPIRES_IN=7
```

### Frontend URLs (CORS)
```env
FRONTEND_URL=https://aurainteriors.live
ADMIN_URL=https://admin.aurainteriors.live
```

### Backend URL (Critical for Keep-Alive)
```env
BACKEND_URL=https://your-service-name.onrender.com
```

### Keep-Alive Service (Prevents Idle Shutdown)
```env
KEEP_ALIVE_ENABLED=true
KEEP_ALIVE_INTERVAL=14
```

### External Services
```env
BREVO_API_KEY=your_brevo_key
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

## Health Check Endpoints

### Liveness Probe (Fast - for load balancers)
```
GET /health
Response: { "status": "ok", "uptime": 12345 }
```

### Readiness Probe (Deep - checks database)
```
GET /health/ready
Response: { "status": "ok", "dependencies": { "database": "connected" } }
```

### Keep-Alive Service Status
```
GET /api/v1/system/keep-alive-status
Response: { "enabled": true, "running": true, "requestCount": 45 }
```

## Render Configuration

### Environment
- Set `NODE_ENV=production`
- Add all production environment variables (see above)

### Health Check (Render Dashboard)
1. Go to Settings → Health Check
2. Enable: `/health`
3. Interval: 30 seconds (or longer)
4. Timeout: 10 seconds

### Keep-Alive (Important!)
- Use Uptime Robot (free) OR
- Use Cron.is (free) OR
- Enable Render's health check

**See**: `../KEEP_ALIVE_SETUP.md` for detailed instructions

## Deployment Steps

1. **Prepare Environment Variables**
   - Copy all production env vars to Render dashboard
   - Ensure `BACKEND_URL` is set to your service URL

2. **Deploy**
   - Push to main branch (or trigger manually in Render)
   - Wait for build to complete

3. **Verify Health**
   ```bash
   curl https://your-service-name.onrender.com/health
   curl https://your-service-name.onrender.com/health/ready
   curl https://your-service-name.onrender.com/api/v1/system/keep-alive-status
   ```

4. **Set Up Monitoring**
   - Add external monitor in Uptime Robot or Cron.is
   - Point to: `https://your-service-name.onrender.com/health`
   - Interval: 5 minutes

5. **Monitor Logs**
   - Check Render logs for errors
   - Look for `[KeepAlive]` entries to confirm pinging

## Troubleshooting

### Service Keeps Spinning Down
- Verify `KEEP_ALIVE_ENABLED=true` in Render
- Verify `BACKEND_URL` is correct and accessible
- Ensure external monitor (Uptime Robot) is running
- Check Render logs for connectivity issues

### High Response Times
- Normal on cold starts (first request after spin-down)
- Internal keep-alive reduces frequency but doesn't eliminate it
- External monitor + internal service together minimize cold starts

### Database Connection Errors
- Verify `MONGO_URI` is correct
- Check database is accessible from Render
- Verify IP whitelist if using MongoDB Atlas

## Performance Tips

- Render free tier: `KEEP_ALIVE_INTERVAL=14` (pings every 14 min)
- Render pro tier: `KEEP_ALIVE_INTERVAL=25` (pings every 25 min)
- Use external monitoring for reliability
- Monitor response times to catch performance issues early

## References

- Render Docs: https://render.com/docs
- Node.js Health Checks: https://nodejs.org/en/docs/guides/simple-profiling/
- Keep-Alive Guide: `../KEEP_ALIVE_SETUP.md`

---

**Last Updated**: 2024-01-15

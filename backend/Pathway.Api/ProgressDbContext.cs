using Microsoft.EntityFrameworkCore;

namespace Pathway.Api;

public sealed class ProgressDbContext(DbContextOptions<ProgressDbContext> options) : DbContext(options)
{
    public DbSet<LearnerProgress> Progress => Set<LearnerProgress>();
    public DbSet<LearnerSubmission> Submissions => Set<LearnerSubmission>();
    public DbSet<WorkspaceProject> WorkspaceProjects => Set<WorkspaceProject>();
    public DbSet<WorkspaceFile> WorkspaceFiles => Set<WorkspaceFile>();
    public DbSet<ReviewSchedule> ReviewSchedules => Set<ReviewSchedule>();
    public DbSet<CommunityPost> CommunityPosts => Set<CommunityPost>();
    public DbSet<CommunityReply> CommunityReplies => Set<CommunityReply>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<LearnerProgress>(entity =>
        {
            entity.ToTable("learner_progress");
            entity.HasKey(item => item.Id);
            entity.HasIndex(item => new { item.LearnerId, item.LessonSlug }).IsUnique();
            entity.Property(item => item.LearnerId).HasMaxLength(100);
            entity.Property(item => item.LessonSlug).HasMaxLength(200);
        });
        modelBuilder.Entity<LearnerSubmission>(entity =>
        {
            entity.ToTable("learner_submissions");
            entity.HasKey(item => item.Id);
            entity.HasIndex(item => new { item.LearnerId, item.CreatedAt });
            entity.Property(item => item.LearnerId).HasMaxLength(100);
            entity.Property(item => item.LessonSlug).HasMaxLength(200);
        });
        modelBuilder.Entity<WorkspaceProject>(entity =>
        {
            entity.ToTable("workspace_projects");
            entity.HasKey(item => item.Id);
            entity.HasIndex(item => new { item.LearnerId, item.TemplateId }).IsUnique();
            entity.Property(item => item.LearnerId).HasMaxLength(100);
            entity.Property(item => item.TemplateId).HasMaxLength(100);
            entity.Property(item => item.Title).HasMaxLength(160);
        });
        modelBuilder.Entity<WorkspaceFile>(entity =>
        {
            entity.ToTable("workspace_files");
            entity.HasKey(item => item.Id);
            entity.HasIndex(item => new { item.ProjectId, item.Path }).IsUnique();
            entity.Property(item => item.Path).HasMaxLength(260);
            entity.Property(item => item.Content).HasMaxLength(100_000);
        });
        modelBuilder.Entity<ReviewSchedule>(entity =>
        {
            entity.ToTable("review_schedules");
            entity.HasKey(item => item.Id);
            entity.HasIndex(item => new { item.LearnerId, item.LessonSlug }).IsUnique();
            entity.Property(item => item.LearnerId).HasMaxLength(100);
            entity.Property(item => item.LessonSlug).HasMaxLength(200);
        });
        modelBuilder.Entity<CommunityPost>(entity =>
        {
            entity.ToTable("community_posts");
            entity.HasKey(item => item.Id);
            entity.HasIndex(item => new { item.CourseId, item.CreatedAt });
            entity.Property(item => item.AuthorId).HasMaxLength(100);
            entity.Property(item => item.CourseId).HasMaxLength(100);
            entity.Property(item => item.Title).HasMaxLength(180);
            entity.Property(item => item.Body).HasMaxLength(10_000);
        });
        modelBuilder.Entity<CommunityReply>(entity =>
        {
            entity.ToTable("community_replies");
            entity.HasKey(item => item.Id);
            entity.HasIndex(item => new { item.PostId, item.CreatedAt });
            entity.Property(item => item.AuthorId).HasMaxLength(100);
            entity.Property(item => item.Body).HasMaxLength(10_000);
        });
    }
}


public sealed class LearnerProgress
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public required string LearnerId { get; init; }
    public required string LessonSlug { get; init; }
    public DateTimeOffset CompletedAt { get; set; }
}

public sealed class LearnerSubmission
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public required string LearnerId { get; init; }
    public required string LessonSlug { get; init; }
    public string? Answer { get; init; }
    public string? Code { get; init; }
    public bool Passed { get; init; }
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
}

public sealed class WorkspaceProject
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public required string LearnerId { get; init; }
    public required string TemplateId { get; init; }
    public required string Title { get; set; }
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public List<WorkspaceFile> Files { get; init; } = [];
}

public sealed class WorkspaceFile
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public Guid ProjectId { get; init; }
    public required string Path { get; set; }
    public required string Content { get; set; }
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class ReviewSchedule
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public required string LearnerId { get; init; }
    public required string LessonSlug { get; init; }
    public int IntervalDays { get; set; } = 1;
    public DateTimeOffset DueAt { get; set; } = DateTimeOffset.UtcNow.AddDays(1);
    public DateTimeOffset LastReviewedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class CommunityPost
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public required string AuthorId { get; init; }
    public required string CourseId { get; init; }
    public required string Title { get; init; }
    public required string Body { get; init; }
    public bool NeedsMentor { get; init; }
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
}

public sealed class CommunityReply
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public Guid PostId { get; init; }
    public required string AuthorId { get; init; }
    public required string Body { get; init; }
    public bool IsMentor { get; init; }
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
}

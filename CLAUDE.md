# Takaro Inventory Tracking - Development Guide

## Git Worktree Workflow

When starting work on a new feature, consider using a git worktree. This allows multiple AI agent sessions to work on different features simultaneously without conflicts.

### When to Use Worktrees

✅ **Use worktrees when:**
- Working on multiple features in parallel
- Running multiple AI agents on different features simultaneously
- Testing changes without switching branches
- Comparing different versions side-by-side

❌ **Skip worktrees when:**
- Making small changes or bug fixes
- Continuing work on the same feature
- Working alone on a single task

### Basic Commands

```bash
# Create a new worktree for a feature
git worktree add ../Takaro-Inventory-Tracking-feature-name feature/feature-name

# List all worktrees
git worktree list

# When done, merge the feature back to main
cd /home/zmedh/Takaro-Projects/Takaro-Inventory-Tracking
git merge feature/feature-name

# Clean up the worktree
git worktree remove ../Takaro-Inventory-Tracking-feature-name
git branch -d feature/feature-name  # optional: delete the branch
```

### Example Workflow

```bash
# Main project directory
cd /home/zmedh/Takaro-Projects/Takaro-Inventory-Tracking

# Create a worktree for a new tracking feature
git worktree add ../Takaro-Inventory-Tracking-realtime-updates feature/realtime-updates

# Now you have two directories:
# - /home/zmedh/Takaro-Projects/Takaro-Inventory-Tracking (main branch)
# - /home/zmedh/Takaro-Projects/Takaro-Inventory-Tracking-realtime-updates (feature branch)

# Each can run independently, be worked on by different AI agents, etc.
```

### Benefits

- **No conflicts:** Each worktree is completely isolated
- **Parallel development:** Multiple agents can work simultaneously
- **Easy comparison:** Run both versions to compare changes
- **Simple rollback:** Just switch directories to see different versions

---

**Note:** For most small changes, staying on the same branch is perfectly fine. Worktrees are most useful when you need true parallel development.

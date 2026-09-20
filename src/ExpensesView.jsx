import React, { useState } from 'react';
import { Plus, Search, Trash2, Calendar, DollarSign, FileText, X } from 'lucide-react';
import { api } from './App';

const EXPENSE_CATEGORIES = [
  "Rent",
  "Electricity",
  "Staff Salary",
  "Transport",
  "Maintenance",
  "Other"
];

export default function ExpensesView({ expenses, onSaved, onError }) {
  const [search, setSearch] = useState("");
  const [filterDate, setFilterDate] = useState({ start: "", end: "" });
  const [showModal, setShowModal] = useState(false);
  const [newExpense, setNewExpense] = useState({
    category: "Rent",
    amount: "",
    note: "",
    expense_date: new Date().toISOString().split('T')[0],
    branch_id: null,
    custom_category: ""
  });

  const filteredExpenses = expenses.filter(exp => {
    const matchesSearch = exp.category.toLowerCase().includes(search.toLowerCase()) || 
                          exp.note?.toLowerCase().includes(search.toLowerCase());
    const matchesDate = (!filterDate.start || exp.expense_date >= filterDate.start) &&
                        (!filterDate.end || exp.expense_date <= filterDate.end);
    return matchesSearch && matchesDate;
  });

  const handleAddExpense = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...newExpense,
        category: newExpense.category === "Other" ? newExpense.custom_category : newExpense.category,
        amount: parseFloat(newExpense.amount)
      };
      await api.post("/expenses", payload);
      setNewExpense({
        category: "Rent",
        amount: "",
        note: "",
        expense_date: new Date().toISOString().split('T')[0],
        branch_id: null,
        custom_category: ""
      });
      setShowModal(false);
      await onSaved();
    } catch (error) {
      onError("Add expense", error);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this expense?")) return;
    try {
      await api.delete(`/expenses/${id}`);
      await onSaved();
    } catch (error) {
      onError("Delete expense", error);
    }
  };

  const formatDate = (value) => {
    return new Date(value).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  return (
    <div className="section-view">
      <div className="page-heading">
        <div>
          <h2>Expenses</h2>
          <p>Track your business expenditures</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Add Expense
        </button>
      </div>

      <div className="card" style={{marginBottom: 'var(--spacing-lg)'}}>
        <div className="card-body" style={{padding: 'var(--spacing-lg) var(--spacing-xl)'}}>
          <div className="search-row" style={{display: 'flex', gap: 'var(--spacing-md)', flexWrap: 'wrap', alignItems: 'center'}}>
            <div className="search" style={{flex: 1, minWidth: '280px', maxWidth: '400px'}}>
              <Search size={17} />
              <input
                placeholder="Search expenses..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div style={{display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'center', flexWrap: 'wrap'}}>
              <div style={{display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)'}}>
                <Calendar size={16} />
                <input
                  type="date"
                  className="form-input"
                  style={{width: '160px'}}
                  value={filterDate.start}
                  onChange={(e) => setFilterDate({...filterDate, start: e.target.value})}
                />
              </div>
              <span style={{color: 'var(--color-text-muted)'}}>to</span>
              <div style={{display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)'}}>
                <Calendar size={16} />
                <input
                  type="date"
                  className="form-input"
                  style={{width: '160px'}}
                  value={filterDate.end}
                  onChange={(e) => setFilterDate({...filterDate, end: e.target.value})}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="table-head">
          <div className="table-head-cell">DATE</div>
          <div className="table-head-cell">CATEGORY</div>
          <div className="table-head-cell">NOTE</div>
          <div className="table-head-cell">AMOUNT</div>
          <div className="table-head-cell">ACTION</div>
        </div>
        {filteredExpenses.map((exp) => (
          <div className="table-row" key={exp.id}>
            <div className="table-cell">
              <span className="table-cell-content">{formatDate(exp.expense_date)}</span>
            </div>
            <div className="table-cell">
              <span className="table-cell-content" style={{fontWeight: 500, color: 'var(--color-primary)'}}>{exp.category}</span>
            </div>
            <div className="table-cell">
              <span className="table-cell-content" style={{maxWidth: '300px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', display: 'block'}}>{exp.note || "—"}</span>
            </div>
            <div className="table-cell">
              <strong className="table-cell-content" style={{fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-base)'}}>
                ₹{Number(exp.amount || 0).toFixed(2)}
              </strong>
            </div>
            <div className="table-cell table-cell-action">
              <button className="btn btn-secondary btn-sm icon-btn" onClick={() => handleDelete(exp.id)} aria-label="Delete expense">
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
        {!filteredExpenses.length && (
          <div className="empty-state">
            <FileText size={28} />
            <strong>No expenses found</strong>
            <span>Add your first expense to start tracking.</span>
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add New Expense</h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleAddExpense} className="expense-form" style={{display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)'}}>
              <div className="form-group">
                <label className="form-label">Category</label>
                <div style={{display: 'flex', gap: 'var(--spacing-md)', flexWrap: 'wrap', alignItems: 'flex-end'}}>
                  <select
                    className="form-select"
                    style={{flex: 1, minWidth: '200px'}}
                    value={newExpense.category}
                    onChange={(e) => setNewExpense({...newExpense, category: e.target.value})}
                  >
                    {EXPENSE_CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                  {newExpense.category === "Other" && (
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Enter custom category"
                      value={newExpense.custom_category}
                      onChange={(e) => setNewExpense({...newExpense, custom_category: e.target.value})}
                      autoFocus
                      style={{flex: 1, minWidth: '200px'}}
                    />
                  )}
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Amount</label>
                  <div className="input-wrapper" style={{display: 'flex', alignItems: 'center'}}>
                    <DollarSign size={18} className="input-icon" style={{position: 'absolute', left: 'var(--spacing-md)', color: 'var(--color-text-muted)', pointerEvents: 'none'}} />
                    <input
                      type="number"
                      className="form-input"
                      style={{paddingLeft: '40px'}}
                      step="0.01"
                      required
                      value={newExpense.amount}
                      onChange={(e) => setNewExpense({...newExpense, amount: e.target.value})}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Date</label>
                  <div className="input-wrapper" style={{display: 'flex', alignItems: 'center'}}>
                    <Calendar size={18} className="input-icon" style={{position: 'absolute', left: 'var(--spacing-md)', color: 'var(--color-text-muted)', pointerEvents: 'none'}} />
                    <input
                      type="date"
                      className="form-input"
                      style={{paddingLeft: '40px'}}
                      required
                      value={newExpense.expense_date}
                      onChange={(e) => setNewExpense({...newExpense, expense_date: e.target.value})}
                    />
                  </div>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Note (Optional)</label>
                <div className="input-wrapper" style={{display: 'flex', alignItems: 'center'}}>
                  <FileText size={18} className="input-icon" style={{position: 'absolute', left: 'var(--spacing-md)', color: 'var(--color-text-muted)', pointerEvents: 'none'}} />
                  <input
                    type="text"
                    className="form-input"
                    style={{paddingLeft: '40px'}}
                    value={newExpense.note}
                    onChange={(e) => setNewExpense({...newExpense, note: e.target.value})}
                  />
                </div>
              </div>
              <div className="form-actions" style={{display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-md)', marginTop: 'var(--spacing-md)'}}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Expense
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
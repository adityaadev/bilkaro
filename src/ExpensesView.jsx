import React, { useState, useEffect } from 'react';
import { Plus, Search, Trash2, Calendar, Tag, DollarSign, FileText, X } from 'lucide-react';
import { api } from './App';

const EXPENSE_CATEGORIES = [
  "Rent",
  "Electricity",
  "Staff Salary",
  "Transport",
  "Maintenance",
  "Other"
];

export default function ExpensesView({ expenses, onSaved, onError, onOpen }) {
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
      onSaved();
    } catch (error) {
      onError(error);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this expense?")) return;
    try {
      await api.delete(`/expenses/${id}`);
      onSaved();
    } catch (error) {
      onError(error);
    }
  };

  return (
    <div className="view-container">
      <div className="view-header">
        <div className="view-title-group">
          <h1>Expenses</h1>
          <p>Track your business expenditures</p>
        </div>
        <button className="primary-btn" onClick={() => setShowModal(true)}>
          <Plus size={20} />
          <span>Add Expense</span>
        </button>
      </div>

      <div className="view-controls">
        <div className="search-wrapper">
          <Search size={18} className="search-icon" />
          <input 
            type="text" 
            placeholder="Search expenses..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="date-filter-group">
          <div className="filter-input-wrapper">
            <Calendar size={18} className="filter-icon" />
            <input 
              type="date" 
              value={filterDate.start}
              onChange={(e) => setFilterDate({...filterDate, start: e.target.value})}
            />
          </div>
          <span className="separator">-</span>
          <div className="filter-input-wrapper">
            <Calendar size={18} className="filter-icon" />
            <input 
              type="date" 
              value={filterDate.end}
              onChange={(e) => setFilterDate({...filterDate, end: e.target.value})}
            />
          </div>
        </div>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Category</th>
              <th>Note</th>
              <th>Amount</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredExpenses.map((exp) => (
              <tr key={exp.id}>
                <td>{exp.expense_date}</td>
                <td>
                  <span className="badge badge-category">{exp.category}</span>
                </td>
                <td>{exp.note || "-"}</td>
                <td className="font-mono font-bold">{exp.amount.toFixed(2)}</td>
                <td className="text-right">
                  <button className="icon-btn delete-btn" onClick={() => handleDelete(exp.id)}>
                    <Trash2 size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Add New Expense</h2>
              <button className="icon-btn" onClick={() => setShowModal(false)}>
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleAddExpense} className="expense-form">
              <div className="form-group">
                <label>Category</label>
                <div className="category-select-wrapper">
                  <select 
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
                      placeholder="Enter custom category"
                      value={newExpense.custom_category}
                      onChange={(e) => setNewExpense({...newExpense, custom_category: e.target.value})}
                      autoFocus
                    />
                  )}
                </div>
              </div>
              <div className="form-group">
                <label>Amount</label>
                <div className="input-wrapper">
                  <DollarSign size={18} className="input-icon" />
                  <input 
                    type="number" 
                    step="0.01" 
                    required
                    value={newExpense.amount}
                    onChange={(e) => setNewExpense({...newExpense, amount: e.target.value})}
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Date</label>
                <div className="input-wrapper">
                  <Calendar size={18} className="input-icon" />
                  <input 
                    type="date" 
                    required
                    value={newExpense.expense_date}
                    onChange={(e) => setNewExpense({...newExpense, expense_date: e.target.value})}
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Note (Optional)</label>
                <div className="input-wrapper">
                  <FileText size={18} className="input-icon" />
                  <input 
                    type="text" 
                    value={newExpense.note}
                    onChange={(e) => setNewExpense({...newExpense, note: e.target.value})}
                  />
                </div>
              </div>
              <div className="form-actions">
                <button type="submit" className="primary-btn full-width">
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
